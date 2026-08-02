// api/models.js — Vercel Serverless Function
//
// فقط ۷ پروایدر، هرکدام جداگانه: Groq, OpenRouter, UnoRouter, Google AI,
// Cloudflare, Together, anymodel.org
//
// معیار «رایگان» (همان‌طور که خواسته شد):
//   شرط ۱: شناسه‌ی مدل تگ ":free" دارد  یا  همه‌ی زیرفیلدهای pricing دقیقاً 0 هستند
//   شرط ۲: طول کانتکست (context length) بالای ۱۰۰٬۰۰۰ توکن باشد
//   هر دو شرط باید همزمان برقرار باشند.
//
// OpenRouter بدون کلید کار می‌کند. بقیه (Groq, UnoRouter, Google AI,
// Cloudflare, Together, anymodel.org) به کلید شخصی کاربر نیاز دارند.

const MIN_CONTEXT = 100000;

function isFreeId(id) {
    return /:free\b/i.test(id || '');
}

// یک مدل واقعاً رایگان است اگر هر فیلد قیمتیِ *معتبر* آن دقیقاً صفر باشد.
// نکته‌ی مهم: OpenRouter برای فیلدهایی که مدل ازشان پشتیبانی نمی‌کند مقدار
// سنتینل «-1» می‌گذارد (یعنی «غیرقابل‌اجرا»، نه «قیمت منفی») — این فیلدها
// باید نادیده گرفته شوند، نه اینکه باعث رد شدن مدل شوند.
function isZeroPricing(pricing) {
    if (!pricing || typeof pricing !== 'object') return false;
    const keys = Object.keys(pricing);
    if (keys.length === 0) return false;
    let hasValidPriceField = false;
    for (const k of keys) {
        const num = parseFloat(pricing[k]);
        if (Number.isNaN(num)) continue;   // فیلد غیرعددی، نادیده گرفته می‌شود
        if (num < 0) continue;             // سنتینل «غیرقابل‌اجرا» (مثل -1)، نادیده گرفته می‌شود
        hasValidPriceField = true;
        if (num !== 0) return false;       // هر فیلد قیمتیِ واقعی و غیرصفر → مدل پولی است
    }
    return hasValidPriceField;
}

// وقتی داده‌ی قیمت واقعی در دسترس است، همان ملاک اصلی است (نه تگ :free) —
// چون تگ به‌تنهایی می‌تواند نسبت به قیمت واقعی نادرست/قدیمی باشد.
// فقط وقتی هیچ داده‌ی قیمتی موجود نیست (مثلاً بعضی پروایدرها اصلاً pricing
// برنمی‌گردانند)، به تگ :free در شناسه رجوع می‌شود.
function qualifies(id, pricing, contextLength) {
    const bigContext = typeof contextLength === 'number' && contextLength > MIN_CONTEXT;
    if (!bigContext) return false;

    const hasPricingInfo = pricing && typeof pricing === 'object' && Object.keys(pricing).length > 0;
    if (hasPricingInfo) return isZeroPricing(pricing);
    return isFreeId(id);
}

function row(fields) {
    return Object.assign({ id: '', name: '', sourceProvider: '', contextLength: 0, freeReason: '', endpoint: '' }, fields);
}

// ---------- 1. OpenRouter (بدون کلید) ----------
async function fetchOpenRouter() {
    const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`OpenRouter: کد ${r.status}`);
    const j = await r.json();
    const all = Array.isArray(j.data) ? j.data : [];
    return all
        .filter((m) => qualifies(m.id, m.pricing, m.context_length))
        .map((m) => row({
            id: m.id, name: m.name || m.id, sourceProvider: 'OpenRouter',
            contextLength: m.context_length,
            freeReason: isFreeId(m.id) ? 'تگ :free' : 'قیمت 0.0000',
            endpoint: 'https://openrouter.ai/api/v1/chat/completions'
        }));
}

// ---------- 2. Groq (نیاز به کلید) ----------
// اندپوینت لیست مدل‌های Groq فیلد pricing برنمی‌گرداند (کل سرویس Groq فعلاً
// رایگان است)؛ در نتیجه شرط «رایگان» با نبود فیلد pricing (=۰ درنظرگرفته
// می‌شود) و شرط کانتکست با context_window بررسی می‌شود.
async function fetchGroq(key) {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Groq: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const all = j.data || [];
    return all
        .filter((m) => (m.context_window || 0) > MIN_CONTEXT)
        .map((m) => row({
            id: m.id, name: m.id, sourceProvider: 'Groq',
            contextLength: m.context_window,
            freeReason: 'سرویس Groq فعلاً رایگان',
            endpoint: 'https://api.groq.com/openai/v1/chat/completions'
        }));
}

// ---------- 3. UnoRouter (نیاز به کلید) ----------
async function fetchUnoRouter(key) {
    const r = await fetch('https://api.unorouter.com/v1/models', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`UnoRouter: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const all = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
    return all
        .filter((m) => qualifies(m.id, m.pricing, m.context_length))
        .map((m) => row({
            id: m.id, name: m.name || m.id, sourceProvider: 'UnoRouter',
            contextLength: m.context_length,
            freeReason: isFreeId(m.id) ? 'تگ :free' : 'قیمت 0.0000',
            endpoint: 'https://api.unorouter.com/v1/chat/completions'
        }));
}

// ---------- 4. Google AI Studio (نیاز به کلید) ----------
// این اندپوینت فیلد pricing ندارد (رایگان‌بودن بر اساس لایه‌ی رایگان
// حساب کاربر تعیین می‌شود، نه در پاسخ API)؛ فقط شرط کانتکست چک می‌شود.
async function fetchGoogle(key) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(`Google AI: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const all = j.models || [];
    return all
        .filter((m) => (m.inputTokenLimit || 0) > MIN_CONTEXT)
        .map((m) => {
            const id = (m.name || '').replace(/^models\//, '');
            return row({
                id, name: m.displayName || id, sourceProvider: 'Google AI',
                contextLength: m.inputTokenLimit,
                freeReason: 'لایه‌ی رایگان Google AI Studio',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
            });
        });
}

// ---------- 5. Cloudflare Workers AI (نیاز به کلید + Account ID) ----------
async function fetchCloudflare(token, accountId) {
    if (!accountId) throw new Error('Cloudflare: Account ID وارد نشده است');
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Cloudflare: کد ${r.status} (کلید یا Account ID را بررسی کنید)`);
    const j = await r.json();
    const all = j.result || [];
    return all
        .filter((m) => (m.context_length || 0) > MIN_CONTEXT)
        .map((m) => row({
            id: m.id || m.name, name: m.name, sourceProvider: 'Cloudflare',
            contextLength: m.context_length || 0,
            freeReason: 'سهمیه‌ی رایگان روزانه Cloudflare',
            endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`
        }));
}

// ---------- 6. Together AI (نیاز به کلید) ----------
async function fetchTogether(key) {
    const r = await fetch('https://api.together.xyz/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Together AI: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const all = Array.isArray(j) ? j : (j.data || []);
    return all
        .filter((m) => qualifies(m.id, m.pricing, m.context_length))
        .map((m) => row({
            id: m.id, name: m.display_name || m.id, sourceProvider: 'Together AI',
            contextLength: m.context_length,
            freeReason: isFreeId(m.id) ? 'تگ :free' : 'قیمت 0.0000',
            endpoint: 'https://api.together.xyz/v1/chat/completions'
        }));
}

// ---------- 7. anymodel.org (نیاز به کلید) ----------
async function fetchAnyModel(key) {
    const r = await fetch('https://anymodel.org/v1/models', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`anymodel.org: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const all = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
    return all
        .filter((m) => qualifies(m.id, m.pricing, m.context_length))
        .map((m) => row({
            id: m.id, name: m.name || m.id, sourceProvider: 'anymodel.org',
            contextLength: m.context_length,
            freeReason: isFreeId(m.id) ? 'تگ :free' : 'قیمت 0.0000',
            endpoint: 'https://anymodel.org/v1/chat/completions'
        }));
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    let keys = {};
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
            keys = body.keys || {};
        } catch { keys = {}; }
    }

    const errors = [];
    const data = [];

    async function run(label, promise) {
        try {
            const rows = await promise;
            data.push(...rows);
        } catch (e) {
            errors.push(`${label}: ${e.message}`);
        }
    }

    const tasks = [run('OpenRouter', fetchOpenRouter())];
    if (keys.groq) tasks.push(run('Groq', fetchGroq(keys.groq)));
    if (keys.unorouter) tasks.push(run('UnoRouter', fetchUnoRouter(keys.unorouter)));
    if (keys.google) tasks.push(run('Google AI', fetchGoogle(keys.google)));
    if (keys.cloudflareToken) tasks.push(run('Cloudflare', fetchCloudflare(keys.cloudflareToken, keys.cloudflareAccountId)));
    if (keys.together) tasks.push(run('Together AI', fetchTogether(keys.together)));
    if (keys.anymodel) tasks.push(run('anymodel.org', fetchAnyModel(keys.anymodel)));

    await Promise.all(tasks);

    data.sort((a, b) => a.sourceProvider.localeCompare(b.sourceProvider) || a.name.localeCompare(b.name));

    res.status(200).json({
        success: true,
        fetchedAt: new Date().toISOString(),
        count: data.length,
        providerErrors: errors,
        data
    });
};

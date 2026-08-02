// api/models.js — Vercel Serverless Function
//
// منابع بدون کلید (همیشه فعال):
//   ۱. OpenRouter          → https://openrouter.ai/api/v1/models
//   ۲. HF Router (چندپروایدری، شامل Groq/Together/Fireworks/Novita/Cerebras/...)
//                           → https://router.huggingface.co/v1/models
//      این endpoint برای هر مدل، آرایه‌ای از پروایدرها با قیمت واقعی،
//      لتنسی واقعی (first_token_latency_ms) و throughput واقعی برمی‌گردونه.
//      نسخه‌ی قبلی این کد از huggingface.co/api/models با sort=trending
//      استفاده می‌کرد که پارامتر معتبری نیست و ۴۰۰ برمی‌گردوند — همینجا حذف شد.
//
// منابعی که به کلید کاربر نیاز دارند (اختیاری، از پنل «کلیدهای API»):
//   ۳. UnoRouter            → https://api.unorouter.com/v1/models  (Authorization: Bearer)
//   ۴. Google AI Studio     → https://generativelanguage.googleapis.com/v1beta/models?key=
//   ۵. Cloudflare Workers AI→ .../accounts/{id}/ai/models/search    (Authorization: Bearer + Account ID)
//
// نکته‌ی «GitHub Models»: این سرویس در ۳۰ ژوئیه ۲۰۲۶ توسط گیت‌هاب کاملاً تعطیل شد، به همین دلیل در این پروژه حذف شده است.
// نکته‌ی SiliconFlow/Together/Fireworks/Novita/Groq با کلید مجزا: چون HF Router همه‌ی این‌ها را
// بدون هیچ کلیدی و با داده‌ی دقیق‌تر (قیمت/لتنسی واقعی) پوشش می‌دهد، فیلدهای کلید جداگانه‌شان حذف شد.

function baseItem(fields) {
    return Object.assign({
        id: '', name: '', originProvider: '', sourceProvider: '', description: '',
        contextLabel: 'نامشخص', contextLength: 0, modality: 'نامشخص', isVision: false,
        reasoning: false, createdDate: null, knowledgeCutoff: null, endpoint: '',
        accessType: 'نامشخص', latencyMs: null, throughput: null
    }, fields);
}

function contextLabelOf(tokens) {
    if (!tokens || tokens <= 0) return 'نامشخص';
    return tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : String(tokens);
}

// ---------- ۱. OpenRouter (بدون کلید) ----------
async function fetchOpenRouter() {
    const start = Date.now();
    const upstream = await fetch('https://openrouter.ai/api/v1/models', { headers: { Accept: 'application/json' } });
    const apiLatencyMs = Date.now() - start;
    if (!upstream.ok) throw new Error(`OpenRouter با کد ${upstream.status} پاسخ داد`);
    const json = await upstream.json();
    const all = Array.isArray(json.data) ? json.data : [];
    // «رایگان» یعنی هیچ زیرفیلدی از pricing (prompt, completion, image, audio,
    // request, web_search, internal_reasoning, input_cache_*, ...) هزینه‌ای نداشته باشد.
    // نسخه‌ی قبلی فقط prompt/completion را چک می‌کرد؛ در نتیجه مدل‌هایی مثل Lyria
    // (تولید موسیقی) که قیمتشان در فیلدهای دیگری مثل image/audio است، اشتباهاً
    // رایگان به‌حساب می‌آمدند.
    const free = all.filter((m) => {
        const p = m.pricing;
        if (!p || typeof p !== 'object') return false;
        const keys = Object.keys(p);
        if (keys.length === 0) return false;
        return keys.every((key) => {
            const num = parseFloat(p[key]);
            if (Number.isNaN(num)) return true; // فیلد غیرعددی، نادیده گرفته می‌شود
            return num === 0;
        });
    });
    const data = free.map((m) => baseItem({
        id: m.id,
        name: m.name || m.id,
        originProvider: (m.id.split('/')[0] || 'نامشخص').trim(),
        sourceProvider: 'OpenRouter',
        description: (m.description || '').split('\n')[0].slice(0, 180),
        contextLabel: contextLabelOf(m.context_length),
        contextLength: m.context_length || 0,
        modality: m.architecture?.modality || 'نامشخص',
        isVision: (m.architecture?.input_modalities || []).includes('image'),
        reasoning: !!(m.reasoning && (m.reasoning.mandatory || m.reasoning.default_enabled)),
        createdDate: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
        knowledgeCutoff: m.knowledge_cutoff || null,
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        accessType: 'رایگان (بدون کلید)'
    }));
    return { data, meta: { totalModelsScanned: all.length, apiLatencyMs } };
}

// ---------- ۲. HF Router — چندپروایدری، بدون کلید، قیمت/لتنسی واقعی ----------
async function fetchHFRouter() {
    const r = await fetch('https://router.huggingface.co/v1/models', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Hugging Face Router: کد ${r.status}`);
    const j = await r.json();
    const models = Array.isArray(j.data) ? j.data : [];
    const rows = [];

    models.forEach((m) => {
        const isVision = (m.architecture?.input_modalities || []).includes('image');
        (m.providers || []).forEach((p) => {
            if (p.status !== 'live') return;
            const price = p.pricing || null;
            const isFree = p.is_free === true || (price && parseFloat(price.input) === 0 && parseFloat(price.output) === 0);
            if (!isFree) return; // فقط پروایدرهایی که واقعاً رایگانند نگه داشته می‌شوند

            rows.push(baseItem({
                id: m.id,
                name: m.id,
                originProvider: m.owned_by || (m.id.split('/')[0] || 'نامشخص'),
                sourceProvider: `Hugging Face → ${p.provider}`,
                contextLabel: contextLabelOf(p.context_length),
                contextLength: p.context_length || 0,
                modality: (m.architecture?.input_modalities || []).join('+') || 'نامشخص',
                isVision,
                createdDate: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
                endpoint: 'https://router.huggingface.co/v1/chat/completions',
                accessType: 'رایگان (پروموشن موقت پروایدر، بدون کلید برای مشاهده)',
                latencyMs: p.first_token_latency_ms ? Math.round(p.first_token_latency_ms) : null,
                throughput: p.throughput ? Math.round(p.throughput * 10) / 10 : null
            }));
        });
    });

    return { data: rows, meta: { totalModelsScanned: models.length } };
}

// ---------- ۳. UnoRouter (نیاز به کلید شخصی) ----------
async function fetchUnoRouter(key) {
    const r = await fetch('https://api.unorouter.com/v1/models', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`UnoRouter: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const arr = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
    return arr.map((m) => {
        const id = m.id || '';
        const looksFree = id.includes(':free');
        return baseItem({
            id, name: m.name || id,
            originProvider: (id.split('/')[0] || 'UnoRouter'),
            sourceProvider: 'UnoRouter',
            contextLabel: contextLabelOf(m.context_length),
            contextLength: m.context_length || 0,
            createdDate: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
            endpoint: 'https://api.unorouter.com/v1/chat/completions',
            accessType: looksFree ? 'رایگان (تگ :free در شناسه)' : 'اعتباری/پولی (با کلید شخصی شما)'
        });
    });
}

// ---------- ۴. Google AI Studio (نیاز به کلید شخصی) ----------
async function fetchGoogle(key) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(`Google AI Studio: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    return (j.models || []).map((m) => {
        const id = (m.name || '').replace(/^models\//, '');
        return baseItem({
            id, name: m.displayName || id, originProvider: 'Google', sourceProvider: 'Google AI Studio',
            description: (m.description || '').slice(0, 180),
            contextLabel: contextLabelOf(m.inputTokenLimit), contextLength: m.inputTokenLimit || 0,
            modality: (m.supportedGenerationMethods || []).join(', ') || 'نامشخص',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
            accessType: 'رایگان با محدودیت (لایه‌ی رایگان Google AI Studio)'
        });
    });
}

// ---------- ۵. Cloudflare Workers AI (نیاز به کلید + Account ID) ----------
async function fetchCloudflare(token, accountId) {
    if (!accountId) throw new Error('Cloudflare: Account ID وارد نشده است');
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Cloudflare: کد ${r.status} (کلید یا Account ID را بررسی کنید)`);
    const j = await r.json();
    return (j.result || []).map((m) => baseItem({
        id: m.id || m.name, name: m.name, originProvider: 'Cloudflare', sourceProvider: 'Cloudflare Workers AI',
        description: (m.description || '').slice(0, 180),
        modality: m.task?.name || 'نامشخص',
        endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
        accessType: 'رایگان با سهمیه‌ی روزانه'
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

    let openRouterResult;
    try {
        openRouterResult = await fetchOpenRouter();
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'خطا در دریافت اطلاعات از OpenRouter' });
        return;
    }

    const errors = [];
    const extraData = [];
    const tasks = [];

    tasks.push(fetchHFRouter().then((r) => extraData.push(...r.data)).catch((e) => errors.push('Hugging Face Router: ' + e.message)));
    if (keys.unorouter) tasks.push(fetchUnoRouter(keys.unorouter).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.google) tasks.push(fetchGoogle(keys.google).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.cloudflareToken) tasks.push(fetchCloudflare(keys.cloudflareToken, keys.cloudflareAccountId).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));

    await Promise.all(tasks);

    const data = [...openRouterResult.data, ...extraData]
        .sort((a, b) => a.sourceProvider.localeCompare(b.sourceProvider) || a.name.localeCompare(b.name));

    res.status(200).json({
        success: true,
        source: 'openrouter.ai + router.huggingface.co (هر دو بدون کلید) + پروایدرهایی که کلید برایشان وارد شده',
        fetchedAt: new Date().toISOString(),
        apiLatencyMs: openRouterResult.meta.apiLatencyMs,
        totalModelsScanned: openRouterResult.meta.totalModelsScanned,
        freeModelsCount: data.length,
        providerErrors: errors,
        data
    });
};

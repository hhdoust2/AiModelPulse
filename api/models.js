// api/models.js — Vercel Serverless Function
//
// همیشه از OpenRouter (بدون کلید) داده می‌گیرد.
// اگر کاربر در فرانت‌اند کلید API پروایدرهای دیگر را وارد کند، همان کلید
// در بدنه‌ی درخواست POST برای این تابع فرستاده می‌شود و این تابع مستقیماً
// و زنده از اندپوینت رسمی همان پروایدر (نه هیچ داده‌ی ثابت) مدل‌ها را می‌گیرد.
//
// نکته درباره‌ی «GitHub Models»: این سرویس در تاریخ ۳۰ ژوئیه ۲۰۲۶ توسط گیت‌هاب
// به‌طور کامل تعطیل شد، به همین دلیل عمداً در این پروژه حذف شده است.

function baseItem(fields) {
    return Object.assign({
        id: '', name: '', originProvider: '', sourceProvider: '', description: '',
        contextLabel: 'نامشخص', contextLength: 0, modality: 'نامشخص', isVision: false,
        reasoning: false, createdDate: null, knowledgeCutoff: null, endpoint: '',
        accessType: 'نامشخص'
    }, fields);
}

function contextLabelOf(tokens) {
    if (!tokens || tokens <= 0) return 'نامشخص';
    return tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : String(tokens);
}

// ---------- OpenRouter (بدون کلید) ----------
async function fetchOpenRouter() {
    const start = Date.now();
    const upstream = await fetch('https://openrouter.ai/api/v1/models', { headers: { Accept: 'application/json' } });
    const apiLatencyMs = Date.now() - start;
    if (!upstream.ok) throw new Error(`OpenRouter با کد ${upstream.status} پاسخ داد`);
    const json = await upstream.json();
    const all = Array.isArray(json.data) ? json.data : [];
    const free = all.filter((m) => {
        const p = m.pricing || {};
        return parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0;
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

// ---------- پروایدرهایی که نیاز به کلید کاربر دارند ----------
async function fetchGroq(key) {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Groq: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    return (j.data || []).map((m) => baseItem({
        id: m.id, name: m.id, originProvider: m.owned_by || 'Groq', sourceProvider: 'Groq',
        contextLabel: contextLabelOf(m.context_window), contextLength: m.context_window || 0,
        createdDate: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        accessType: 'رایگان (با کلید شخصی شما)'
    }));
}

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

async function fetchSiliconFlow(key) {
    const r = await fetch('https://api.siliconflow.cn/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`SiliconFlow: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    return (j.data || []).map((m) => baseItem({
        id: m.id, name: m.id, originProvider: (m.id.split('/')[0] || 'SiliconFlow'), sourceProvider: 'SiliconFlow',
        endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
        accessType: 'اعتباری/پولی (چند مدل محدود رایگان)'
    }));
}

async function fetchTogether(key) {
    const r = await fetch('https://api.together.xyz/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Together AI: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.data || []);
    return arr.map((m) => baseItem({
        id: m.id, name: m.display_name || m.id, originProvider: m.organization || 'Together AI', sourceProvider: 'Together AI',
        contextLabel: contextLabelOf(m.context_length), contextLength: m.context_length || 0,
        endpoint: 'https://api.together.xyz/v1/chat/completions',
        accessType: 'پولی (اعتبار آزمایشی اولیه)'
    }));
}

async function fetchHuggingFace(key) {
    const headers = { Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const r = await fetch('https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trending&limit=40', { headers });
    if (!r.ok) throw new Error(`Hugging Face: کد ${r.status}`);
    const arr = await r.json();
    return (Array.isArray(arr) ? arr : []).map((m) => baseItem({
        id: m.id, name: m.id, originProvider: (m.id.split('/')[0] || 'Hugging Face'), sourceProvider: 'Hugging Face',
        endpoint: 'https://router.huggingface.co/v1/chat/completions',
        accessType: 'رایگان با محدودیت (Inference API)'
    }));
}

async function fetchFireworks(key) {
    const r = await fetch('https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless=true', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Fireworks AI: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    const arr = j.models || j.data || [];
    return arr.map((m) => baseItem({
        id: m.name || m.id, name: m.displayName || m.name || m.id, originProvider: 'Fireworks AI', sourceProvider: 'Fireworks AI',
        endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
        accessType: 'پولی'
    }));
}

async function fetchNovita(key) {
    const r = await fetch('https://api.novita.ai/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Novita AI: کد ${r.status} (کلید را بررسی کنید)`);
    const j = await r.json();
    return (j.data || []).map((m) => baseItem({
        id: m.id, name: m.id, originProvider: (m.id.split('/')[0] || 'Novita AI'), sourceProvider: 'Novita AI',
        createdDate: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
        endpoint: 'https://api.novita.ai/openai/v1/chat/completions',
        accessType: 'پولی (اعتبار آزمایشی اولیه)'
    }));
}

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

    if (keys.groq) tasks.push(fetchGroq(keys.groq).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.google) tasks.push(fetchGoogle(keys.google).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.siliconflow) tasks.push(fetchSiliconFlow(keys.siliconflow).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.together) tasks.push(fetchTogether(keys.together).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.huggingface) tasks.push(fetchHuggingFace(keys.huggingface).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.fireworks) tasks.push(fetchFireworks(keys.fireworks).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.novita) tasks.push(fetchNovita(keys.novita).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));
    if (keys.cloudflareToken) tasks.push(fetchCloudflare(keys.cloudflareToken, keys.cloudflareAccountId).then((d) => extraData.push(...d)).catch((e) => errors.push(e.message)));

    await Promise.all(tasks);

    const data = [...openRouterResult.data, ...extraData]
        .sort((a, b) => a.sourceProvider.localeCompare(b.sourceProvider) || a.name.localeCompare(b.name));

    res.status(200).json({
        success: true,
        source: 'openrouter.ai (بدون کلید) + پروایدرهایی که کلید برایشان وارد شده',
        fetchedAt: new Date().toISOString(),
        apiLatencyMs: openRouterResult.meta.apiLatencyMs,
        totalModelsScanned: openRouterResult.meta.totalModelsScanned,
        freeModelsCount: data.length,
        providerErrors: errors,
        data
    });
};

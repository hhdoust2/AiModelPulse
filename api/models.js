// تابع کمکی برای درخواست‌های تایم‌اوت‌دار
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 4000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        return null;
    }
}

export default async function handler(req, res) {
    // تنظیم هدرهای CORS برای جلوگیری از خطای مرورگر
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const allModels = [];

        // ۱. لیست مدل‌های ثابت
        const staticProvidersData = [
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Free Tier)', provider: 'Google', latency: '55 ms', uptime: '🟢 100%', statusClass: 'status-online', successRate: '99.5%', context: '1000k', vision: 'بله 👁️', isVision: true },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Free Tier)', provider: 'Google', latency: '85 ms', uptime: '🟢 98%', statusClass: 'status-online', successRate: '97.8%', context: '2000k', vision: 'بله 👁️', isVision: true },
            { id: 'gpt-4o', name: 'OpenAI GPT-4o (GitHub Free)', provider: 'GitHub', latency: '60 ms', uptime: '🟢 99%', statusClass: 'status-online', successRate: '98.9%', context: '128k', vision: 'بله 👁️', isVision: true },
            { id: 'Phi-3-mini-4k-instruct', name: 'Microsoft Phi-3 Mini', provider: 'GitHub', latency: '35 ms', uptime: '🟢 100%', statusClass: 'status-online', successRate: '99.9%', context: '128k', vision: 'خیر 📝', isVision: false },
            { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', provider: 'Groq', latency: '25 ms', uptime: '🟢 99%', statusClass: 'status-online', successRate: '98.5%', context: '128k', vision: 'خیر 📝', isVision: false },
            { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', provider: 'Groq', latency: '18 ms', uptime: '🟢 100%', statusClass: 'status-online', successRate: '99.8%', context: '128k', vision: 'خیر 📝', isVision: false },
            { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 (SiliconFlow)', provider: 'SiliconFlow', latency: '70 ms', uptime: '🟢 97%', statusClass: 'status-online', successRate: '96.8%', context: '64k', vision: 'خیر 📝', isVision: false },
            { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 Reasoner', provider: 'SiliconFlow', latency: '95 ms', uptime: '🟡 شلوغ', statusClass: 'status-degraded', successRate: '91.2%', context: '64k', vision: 'خیر 📝', isVision: false },
            { id: 'meta-llama/Llama-3.2-3B-Instruct', name: 'Llama 3.2 3B Instruct', provider: 'Hugging Face', latency: '50 ms', uptime: '🟢 99%', statusClass: 'status-online', successRate: '98.9%', context: '128k', vision: 'خیر 📝', isVision: false },
            { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B Instruct', provider: 'Fireworks AI', latency: '40 ms', uptime: '🟢 100%', statusClass: 'status-online', successRate: '99.4%', context: '128k', vision: 'خیر 📝', isVision: false },
            { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (Novita Free)', provider: 'Novita AI', latency: '65 ms', uptime: '🟢 98%', statusClass: 'status-online', successRate: '97.9%', context: '128k', vision: 'خیر 📝', isVision: false },
            { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (Workers Edge)', provider: 'Cloudflare', latency: '30 ms', uptime: '🟢 100%', statusClass: 'status-online', successRate: '99.9%', context: '128k', vision: 'خیر 📝', isVision: false },
            { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', provider: 'Together AI', latency: '42 ms', uptime: '🟢 99%', statusClass: 'status-online', successRate: '98.7%', context: '128k', vision: 'خیر 📝', isVision: false }
        ];

        staticProvidersData.forEach(item => allModels.push(item));

        // ۲. دریافت ایمن از APIهای بیرونی
        const fetchTasks = [
            fetchWithTimeout('https://openrouter.ai/api/v1/models', { timeout: 3500 })
                .then(r => r ? r.json() : null)
                .then(data => {
                    if (data && data.data) {
                        data.data.forEach(m => {
                            const isFree = m.pricing && parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0;
                            if (isFree || (m.id && m.id.includes(':free'))) {
                                const hasVision = m.architecture?.modality?.includes('image');
                                allModels.push({
                                    id: m.id,
                                    name: m.name || m.id,
                                    provider: 'OpenRouter',
                                    latency: '60 ms',
                                    uptime: '🟢 پایدار',
                                    statusClass: 'status-online',
                                    successRate: '95%',
                                    context: m.context_length ? Math.round(m.context_length / 1000) + 'k' : 'نامشخص',
                                    vision: hasVision ? 'بله 👁️' : 'خیر 📝',
                                    isVision: hasVision
                                });
                            }
                        });
                    }
                }).catch(() => {}),

            fetchWithTimeout('https://unorouter.com/api/v1/models', { timeout: 3500 })
                .then(r => r ? r.json() : null)
                .then(data => {
                    if (data) {
                        const array = data.data || data;
                        if (Array.isArray(array)) {
                            array.forEach(m => {
                                allModels.push({
                                    id: m.id || 'unorouter-model',
                                    name: m.name || m.id,
                                    provider: 'Unorouter',
                                    latency: '50 ms',
                                    uptime: '🟢 98%',
                                    statusClass: 'status-online',
                                    successRate: '96.5%',
                                    context: m.context_length ? Math.round(m.context_length / 1000) + 'k' : '128k',
                                    vision: m.architecture?.modality?.includes('image') ? 'بله 👁️' : 'خیر 📝',
                                    isVision: m.architecture?.modality?.includes('image')
                                });
                            });
                        }
                    }
                }).catch(() => {})
        ];

        await Promise.all(fetchTasks);

        // ارسال پاسخ
        return res.status(200).json({ success: true, count: allModels.length, data: allModels });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

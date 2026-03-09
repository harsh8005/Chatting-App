const DEFAULT_HF_BASE_URL =
    process.env.HUGGINGFACE_BASE_URL || 'https://router.huggingface.co/hf-inference/models';
const HF_CHAT_COMPLETIONS_URL =
    process.env.HUGGINGFACE_CHAT_BASE_URL || 'https://router.huggingface.co/v1/chat/completions';
const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN || '';

const buildHeaders = (contentType = 'application/json') => {
    const headers = {
        Accept: 'application/json',
        'Content-Type': contentType
    };
    if (HF_TOKEN) {
        headers.Authorization = `Bearer ${HF_TOKEN}`;
    }
    return headers;
};

const parseTextFromResponse = (payload) => {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    if (Array.isArray(payload) && payload[0]) {
        if (payload[0].generated_text) return payload[0].generated_text;
        if (payload[0].summary_text) return payload[0].summary_text;
        if (payload[0].label) return payload[0].label;
        if (payload[0].text) return payload[0].text;
    }
    if (payload.generated_text) return payload.generated_text;
    if (payload.summary_text) return payload.summary_text;
    if (payload.choices && payload.choices[0] && payload.choices[0].message) {
        return payload.choices[0].message.content || '';
    }
    return '';
};

const isRecoverableRouterError = (status, bodyText) => {
    if (status === 404 || status === 410) return true;
    const value = String(bodyText || '').toLowerCase();
    return value.includes('no longer supported') || value.includes('router.huggingface.co');
};

const inferenceTextViaChatCompletions = async ({ model, inputs, parameters = {} }) => {
    const response = await fetch(HF_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: String(inputs || '') }],
            max_tokens: Number(parameters.max_new_tokens || 220),
            temperature:
                parameters.temperature === undefined ? 0.3 : Number(parameters.temperature),
            top_p: 0.95
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HF chat inference failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    return {
        ok: true,
        text: parseTextFromResponse(payload),
        raw: payload
    };
};

const inferenceText = async ({ model, inputs, parameters = {}, options = {} }) => {
    if (!HF_TOKEN) {
        return { ok: false, fallback: true, text: '' };
    }

    const safeModel = encodeURIComponent(model);
    const response = await fetch(`${DEFAULT_HF_BASE_URL}/${safeModel}`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
            inputs,
            parameters,
            options: { wait_for_model: true, use_cache: false, ...options }
        })
    });

    if (!response.ok) {
        const text = await response.text();
        if (isRecoverableRouterError(response.status, text)) {
            return inferenceTextViaChatCompletions({ model, inputs, parameters });
        }
        throw new Error(`HF text inference failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    return {
        ok: true,
        text: parseTextFromResponse(payload),
        raw: payload
    };
};

const inferenceAudio = async ({ model, buffer, mimeType = 'audio/webm' }) => {
    if (!HF_TOKEN) {
        return { ok: false, fallback: true, text: '' };
    }

    const safeModel = encodeURIComponent(model);
    const response = await fetch(`${DEFAULT_HF_BASE_URL}/${safeModel}`, {
        method: 'POST',
        headers: buildHeaders(mimeType),
        body: buffer
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HF audio inference failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const payload = await response.json();
    return {
        ok: true,
        text: parseTextFromResponse(payload),
        raw: payload
    };
};

module.exports = {
    inferenceText,
    inferenceAudio
};

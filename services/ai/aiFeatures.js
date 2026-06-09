const fs = require('fs/promises');
const User = require('../../models/userModel');
const GroupChat = require('../../models/groupChatModel');
const { inferenceText, inferenceAudio } = require('./huggingFaceClient');

const MISTRAL_MODEL = process.env.HF_MISTRAL_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';
const TOXIC_MODEL = process.env.HF_TOXIC_MODEL || 'unitary/toxic-bert';
const SENTIMENT_MODEL =
    process.env.HF_SENTIMENT_MODEL || 'cardiffnlp/twitter-roberta-base-sentiment-latest';
const ASR_MODEL = process.env.HF_ASR_MODEL || 'openai/whisper-small';
const TEXT_MODEL_CANDIDATES = [
    MISTRAL_MODEL,
    'Qwen/Qwen2.5-7B-Instruct',
    'meta-llama/Llama-3.1-8B-Instruct'
].filter((model, index, arr) => model && arr.indexOf(model) === index);

const BOT_EMAIL = 'aibot@chatapp.local';
const BOT_IMAGE = 'images/1720171439274-ayush.png';
let missingTokenWarned = false;

const runTextWithModelFallback = async ({ inputs, parameters = {}, options = {} }) => {
    const errors = [];
    for (const model of TEXT_MODEL_CANDIDATES) {
        try {
            const result = await inferenceText({
                model,
                inputs,
                parameters,
                options
            });
            if (result.ok && result.text) {
                return { ok: true, text: result.text, model, errors };
            }
            if (result.fallback) {
                return { ok: false, fallback: true, model, errors };
            }
        } catch (error) {
            errors.push({ model, error: error.message });
        }
    }
    return { ok: false, errors };
};

const fallbackSummary = (messages) => {
    const rows = messages.slice(-60).filter((m) => (m.message || '').trim());
    if (!rows.length) return 'No meaningful text available for summary.';

    const participants = Array.from(new Set(rows.map((m) => m.sender_name || 'User'))).slice(0, 6);
    const keyLines = rows
        .map((m) => (m.message || '').trim())
        .filter(Boolean)
        .filter((line) => line.length > 8)
        .slice(-6);

    return [
        'AI summary generated in local fallback mode.',
        `Participants: ${participants.join(', ')}`,
        `Messages analyzed: ${rows.length}`,
        'Key points:',
        ...keyLines.map((line, idx) => `${idx + 1}. ${line}`)
    ].join('\n');
};

const fallbackTopics = (messages) => {
    const corpus = messages.map((m) => (m.message || '').toLowerCase()).join(' ');
    const seedWords = ['project', 'meeting', 'bug', 'release', 'design', 'api', 'deploy', 'test', 'client', 'ui'];
    return seedWords.filter((word) => corpus.includes(word)).slice(0, 5);
};

const localSpamHeuristic = (text) => {
    const value = String(text || '').toLowerCase();
    const spamSignals = ['buy now', 'free money', 'click here', 'visit now', 'earn instantly', 'http://', 'https://'];
    const score = spamSignals.reduce((acc, signal) => (value.includes(signal) ? acc + 1 : acc), 0);
    return score >= 2;
};

const moderateText = async (text) => {
    const cleaned = String(text || '').trim();
    if (!cleaned) return { blocked: false, reason: null, toxicity: 0, spam: false };

    const spam = localSpamHeuristic(cleaned);
    let toxicity = 0;
    try {
        const toxic = await inferenceText({
            model: TOXIC_MODEL,
            inputs: cleaned
        });

        if (toxic.ok && Array.isArray(toxic.raw) && toxic.raw[0]) {
            const labels = toxic.raw[0];
            const toxicLabel = labels.find((x) => String(x.label || '').toLowerCase().includes('toxic'));
            toxicity = toxicLabel ? Number(toxicLabel.score || 0) : 0;
        }
    } catch (error) {
        toxicity = 0;
    }

    const blocked = spam || toxicity > 0.88;
    return {
        blocked,
        reason: spam ? 'Potential spam detected' : blocked ? 'High toxicity detected' : null,
        toxicity,
        spam
    };
};

const summarizeMessages = async (messages, objective = 'thread summary') => {
    if (!messages || !messages.length) return 'No messages found.';
    const compact = messages
        .slice(-80)
        .map((m) => `${m.sender_name || 'User'}: ${m.message || '[attachment]'}`)
        .join('\n');

    const prompt = `You are a helpful assistant. Create a concise ${objective} in bullet points.
Keep it practical and under 140 words.

Conversation:
${compact}`;

    try {
        const result = await runTextWithModelFallback({
            inputs: prompt,
            parameters: {
                max_new_tokens: 220,
                temperature: 0.2,
                return_full_text: false
            }
        });
        if (result.ok && result.text) {
            const text = String(result.text || '').trim();
            if (text) return text;
        }
        if (result && result.errors && result.errors.length) {
            console.warn('[AI] summarize fallback. model errors:', result.errors);
        }
    } catch (error) {
        return fallbackSummary(messages);
    }

    return fallbackSummary(messages);
};

const extractTopics = async (messages) => {
    if (!messages || !messages.length) return [];
    const compact = messages
        .slice(-120)
        .map((m) => m.message || '')
        .filter(Boolean)
        .join('\n');

    const prompt = `Extract 3-7 short topic tags from the conversation.
Return only a comma-separated list. No explanation.

Conversation:
${compact}`;

    try {
        const result = await runTextWithModelFallback({
            inputs: prompt,
            parameters: {
                max_new_tokens: 80,
                temperature: 0.1,
                return_full_text: false
            }
        });
        if (result.ok && result.text) {
            return result.text
                .split(',')
                .map((x) => x.trim().replace(/^#/, '').toLowerCase())
                .filter(Boolean)
                .slice(0, 7);
        }
        if (result && result.errors && result.errors.length) {
            console.warn('[AI] topic extraction fallback. model errors:', result.errors);
        }
    } catch (error) {
        return fallbackTopics(messages);
    }

    return fallbackTopics(messages);
};

const transcribeAudioAndSentiment = async ({ filePath, mimeType }) => {
    if (!filePath) return { transcript: '', sentiment: 'neutral', sentiment_score: 0 };

    let transcript = '';
    try {
        const buffer = await fs.readFile(filePath);
        const asr = await inferenceAudio({
            model: ASR_MODEL,
            buffer,
            mimeType: mimeType || 'audio/webm'
        });
        transcript = asr.ok ? String(asr.text || '').trim() : '';
    } catch (error) {
        transcript = '';
    }

    const value = transcript.toLowerCase();
    let localSentiment = 'neutral';
    if (/(great|awesome|good|thanks|happy|excellent)/.test(value)) localSentiment = 'positive';
    if (/(bad|angry|hate|issue|problem|terrible|sad)/.test(value)) localSentiment = 'negative';

    try {
        const sentiment = await inferenceText({
            model: SENTIMENT_MODEL,
            inputs: transcript || 'neutral'
        });
        if (sentiment.ok && Array.isArray(sentiment.raw) && sentiment.raw[0] && sentiment.raw[0][0]) {
            const top = sentiment.raw[0].sort((a, b) => b.score - a.score)[0];
            return {
                transcript,
                sentiment: String(top.label || localSentiment).toLowerCase(),
                sentiment_score: Number(top.score || 0)
            };
        }
    } catch (error) {
        return { transcript, sentiment: localSentiment, sentiment_score: 0 };
    }

    return { transcript, sentiment: localSentiment, sentiment_score: 0 };
};

const ensureAIBotUser = async () => {
    let bot = await User.findOne({ email: BOT_EMAIL });
    if (bot) {
        const image = String(bot.image || '').trim().toLowerCase();
        if (!image || image.endsWith('/aibot.png') || image.endsWith('aibot.png')) {
            bot.image = BOT_IMAGE;
            await bot.save();
        }
        return bot;
    }

    bot = await User.create({
        name: 'AI Bot',
        email: BOT_EMAIL,
        image: BOT_IMAGE,
        password: 'not-used-bot-account',
        is_online: '1'
    });
    return bot;
};

const buildBotReply = async ({ groupName, message, contextMessages = [] }) => {
    const context = contextMessages
        .slice(-20)
        .map((m) => `${m.sender_name || 'User'}: ${m.message || '[attachment]'}`)
        .join('\n');

    const prompt = `You are AI Bot in group "${groupName}".
Reply briefly, clearly, and helpfully to the user's latest question.
If the user asks non-technical questions, still help.

Context:
${context}

User:
${message}

AI Bot response:`;

    try {
        if (!process.env.HUGGINGFACE_API_TOKEN && !missingTokenWarned) {
            missingTokenWarned = true;
            console.warn('[AI] HUGGINGFACE_API_TOKEN is missing. Using local fallback responses.');
        }
        const llm = await runTextWithModelFallback({
            inputs: prompt,
            parameters: {
                max_new_tokens: 200,
                temperature: 0.4,
                return_full_text: false
            }
        });
        if (llm.ok && llm.text) {
            const text = String(llm.text || '').trim();
            if (text) return text;
        }
        if (llm && llm.errors && llm.errors.length) {
            console.warn('[AI] bot reply fallback. model errors:', llm.errors);
        }
        if (llm.fallback) {
            return `AI Bot (offline mode): I noted your message in ${groupName}. Key point: "${message.slice(0, 180)}"`;
        }
    } catch (error) {
        return `AI Bot (fallback): I could not reach HF model, but I captured your query: "${message.slice(0, 180)}"`;
    }

    return `AI Bot (fallback): I received your message in ${groupName}: "${message.slice(0, 180)}"`;
};

const getAiHealthReport = async () => {
    const prompt = 'Reply with exactly: OK';
    const report = {
        has_token: !!process.env.HUGGINGFACE_API_TOKEN,
        tested_models: [],
        recommendation: ''
    };

    if (!report.has_token) {
        report.recommendation = 'Missing HUGGINGFACE_API_TOKEN in .env';
        return report;
    }

    for (const model of TEXT_MODEL_CANDIDATES) {
        try {
            const result = await inferenceText({
                model,
                inputs: prompt,
                parameters: {
                    max_new_tokens: 20,
                    temperature: 0,
                    return_full_text: false
                }
            });
            report.tested_models.push({
                model,
                ok: !!result.ok,
                output: (result.text || '').slice(0, 80)
            });
        } catch (error) {
            report.tested_models.push({
                model,
                ok: false,
                error: String(error.message || '').slice(0, 300)
            });
        }
    }

    const firstWorking = report.tested_models.find((x) => x.ok);
    if (firstWorking) {
        report.recommendation = `Use model: ${firstWorking.model}`;
    } else {
        report.recommendation =
            'No working text model found. Check HF token permissions, quota limits, or model availability.';
    }

    return report;
};

const toContextMessages = async (groupId) => {
    const chats = await GroupChat.find({ group_id: groupId })
        .sort({ createdAt: -1 })
        .limit(40)
        .populate('sender_id', 'name');

    return chats
        .reverse()
        .map((x) => ({
            sender_name: x.sender_id && x.sender_id.name ? x.sender_id.name : 'User',
            message: x.message || ''
        }));
};

module.exports = {
    moderateText,
    summarizeMessages,
    extractTopics,
    transcribeAudioAndSentiment,
    ensureAIBotUser,
    buildBotReply,
    toContextMessages,
    getAiHealthReport
};

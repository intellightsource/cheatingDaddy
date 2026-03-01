(function () {
    const GEMINI_MODELS = new Set([
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-3-flash-preview',
        'gemini-3-pro-preview',
    ]);

    const GROQ_MODEL_IDS = {
        'llama-4-maverick': 'meta-llama/llama-4-maverick-17b-128e-instruct',
        'llama-4-scout': 'meta-llama/llama-4-scout-17b-16e-instruct',
    };

    const MODEL_MAX_TOKENS = {
        'gemini-2.5-flash': 65536,
        'gemini-2.5-flash-lite': 65536,
        'gemini-3-flash-preview': 65536,
        'gemini-3-pro-preview': 65536,
        'llama-4-maverick': 8192,
        'llama-4-scout': 8192,
    };

    const LANGUAGE_MAP = {
        'en-US': 'English',
        'en-GB': 'English',
        'en-AU': 'English',
        'en-IN': 'English',
        'es-ES': 'Spanish',
        'es-US': 'Spanish',
        'fr-FR': 'French',
        'fr-CA': 'French',
        'de-DE': 'German',
        'it-IT': 'Italian',
        'pt-BR': 'Portuguese',
        'pt-PT': 'Portuguese',
        'ru-RU': 'Russian',
        'ja-JP': 'Japanese',
        'ko-KR': 'Korean',
        'zh-CN': 'Chinese (Simplified)',
        'cmn-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        'ar-SA': 'Arabic',
        'ar-XA': 'Arabic',
        'hi-IN': 'Hindi',
        'nl-NL': 'Dutch',
        'pl-PL': 'Polish',
        'tr-TR': 'Turkish',
        'sv-SE': 'Swedish',
        'da-DK': 'Danish',
        'fi-FI': 'Finnish',
        'no-NO': 'Norwegian',
        'th-TH': 'Thai',
        'te-IN': 'Telugu',
        'ta-IN': 'Tamil',
        'mr-IN': 'Marathi',
        'ml-IN': 'Malayalam',
        'kn-IN': 'Kannada',
        'gu-IN': 'Gujarati',
        'bn-IN': 'Bengali',
        'vi-VN': 'Vietnamese',
        'id-ID': 'Indonesian',
    };

    const SCREENSHOT_PROMPTS = {
        interview:
            'Look at this screenshot. If it contains a coding problem, solve it. If it contains interview questions, answer them. If it contains unrelated content, describe what you see in 1 sentence.',
        sales:
            'Look at this screenshot. If it contains a sales-related situation, provide talking points, objection handling, or product positioning. If unrelated, describe what you see in 1 sentence.',
        meeting:
            'Look at this screenshot. If it contains meeting content, summarize key points and suggest responses. If unrelated, describe what you see in 1 sentence.',
        presentation:
            'Look at this screenshot. If it contains presentation content, suggest talking points or answer visible questions. If unrelated, describe what you see in 1 sentence.',
        negotiation:
            'Look at this screenshot. If it contains a negotiation situation, suggest counter-offers, strategies, and responses. If unrelated, describe what you see in 1 sentence.',
        exam: 'Look at this screenshot and solve any visible questions. Return complete answers.',
    };

    const AUTO_SPEECH_FLUSH_MS = 1400;

    const state = {
        initialized: false,
        mode: 'interview',
        profile: 'interview',
        language: 'en-US',
        model: 'llama-4-maverick',
        history: [],
        mediaStream: null,
        screenshotInterval: null,
        hiddenVideo: null,
        offscreenCanvas: null,
        offscreenContext: null,
        imageQuality: 'medium',
        microphoneEnabled: false,
        microphoneStream: null,
        speechRecognition: null,
        speechRecognitionActive: false,
        speechAutoBuffer: '',
        speechManualBuffer: '',
        speechFlushTimer: null,
        speechShouldRestart: false,
        speechQueue: [],
        processingSpeechQueue: false,
    };

    window.randomDisplayName = 'Web Session';

    function getAppElement() {
        return document.querySelector('cheating-daddy-app');
    }

    function isMac() {
        return /Macintosh|Mac OS X/i.test(navigator.userAgent);
    }

    function isLinux() {
        return /Linux/i.test(navigator.userAgent);
    }

    function isGeminiModel(model) {
        return GEMINI_MODELS.has(model);
    }

    function isGroqModel(model) {
        return Object.prototype.hasOwnProperty.call(GROQ_MODEL_IDS, model);
    }

    function getSpeechRecognitionConstructor() {
        return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    function getVadEnabled() {
        const raw = localStorage.getItem('vadEnabled');
        return raw === null ? true : raw === 'true';
    }

    function getVadMode() {
        return localStorage.getItem('vadMode') || 'automatic';
    }

    function parseNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getGenerationSettings(model) {
        const mode = localStorage.getItem('selectedMode') || state.mode || 'interview';
        const keyPrefix = `modelSettings_${model}_${mode}_`;
        const temperature = clamp(parseNumber(localStorage.getItem(`${keyPrefix}temperature`), 0.7), 0, 2);
        const topP = clamp(parseNumber(localStorage.getItem(`${keyPrefix}topP`), 0.95), 0, 1);
        const maxAllowed = MODEL_MAX_TOKENS[model] || 8192;
        const maxOutputTokens = clamp(Math.floor(parseNumber(localStorage.getItem(`${keyPrefix}maxOutputTokens`), 4096)), 256, maxAllowed);
        return { temperature, topP, maxOutputTokens };
    }

    function getLanguageInstruction() {
        const languageName = LANGUAGE_MAP[state.language] || 'English';
        if (languageName === 'English') {
            return '';
        }
        return `\n\nRespond entirely in ${languageName}.`;
    }

    function setStatus(text) {
        const app = getAppElement();
        if (app && typeof app.setStatus === 'function') {
            app.setStatus(text);
        }
    }

    function setResponse(response) {
        const app = getAppElement();
        if (app && typeof app.setResponse === 'function') {
            app.setResponse(response);
        }
    }

    async function ensureMicrophoneAccess() {
        if (state.microphoneStream && state.microphoneStream.getAudioTracks().some(track => track.readyState === 'live')) {
            return true;
        }

        try {
            state.microphoneStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            });
            return true;
        } catch (error) {
            console.error('[Web] Microphone access failed:', error);
            setStatus('Microphone permission denied or unavailable');
            state.microphoneStream = null;
            return false;
        }
    }

    function releaseMicrophoneAccess() {
        if (!state.microphoneStream) {
            return;
        }
        state.microphoneStream.getTracks().forEach(track => track.stop());
        state.microphoneStream = null;
    }

    function clearSpeechFlushTimer() {
        if (state.speechFlushTimer) {
            clearTimeout(state.speechFlushTimer);
            state.speechFlushTimer = null;
        }
    }

    function normalizeSpeechText(text) {
        return String(text || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async function ensureVideoElements() {
        if (!state.mediaStream) {
            throw new Error('No active screen capture stream');
        }

        if (!state.hiddenVideo) {
            state.hiddenVideo = document.createElement('video');
            state.hiddenVideo.srcObject = state.mediaStream;
            state.hiddenVideo.muted = true;
            state.hiddenVideo.playsInline = true;
            await state.hiddenVideo.play();

            await new Promise(resolve => {
                if (state.hiddenVideo.readyState >= 2) {
                    resolve();
                    return;
                }
                state.hiddenVideo.onloadedmetadata = () => resolve();
            });

            state.offscreenCanvas = document.createElement('canvas');
            state.offscreenCanvas.width = state.hiddenVideo.videoWidth || 1920;
            state.offscreenCanvas.height = state.hiddenVideo.videoHeight || 1080;
            state.offscreenContext = state.offscreenCanvas.getContext('2d');
        }
    }

    function qualityToNumber(quality) {
        switch (quality) {
            case 'low':
                return 0.3;
            case 'medium':
                return 0.4;
            case 'high':
            default:
                return 0.5;
        }
    }

    async function canvasToBase64(canvas, quality) {
        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', quality);
        });
        if (!blob) {
            throw new Error('Failed to encode screenshot');
        }
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        return String(dataUrl).split(',')[1];
    }

    async function getScreenshotBase64(imageQuality) {
        await ensureVideoElements();
        if (!state.offscreenContext || !state.offscreenCanvas || !state.hiddenVideo) {
            throw new Error('Screenshot canvas is not initialized');
        }

        if (state.hiddenVideo.readyState < 2) {
            throw new Error('Capture video is not ready yet');
        }

        state.offscreenContext.drawImage(state.hiddenVideo, 0, 0, state.offscreenCanvas.width, state.offscreenCanvas.height);
        return canvasToBase64(state.offscreenCanvas, qualityToNumber(imageQuality || state.imageQuality));
    }

    function buildSystemPrompt() {
        const customPrompt = (localStorage.getItem('customPrompt') || '').trim();
        const profile = state.profile || 'interview';
        const profileHint = {
            interview: 'You are an interview assistant. Keep spoken answers concise and practical.',
            exam: 'You are an exam assistant. Focus on direct, accurate answers.',
            sales: 'You are a sales call assistant. Provide practical talking points.',
            meeting: 'You are a meeting assistant. Summarize and suggest actionable responses.',
            presentation: 'You are a presentation assistant. Help with concise talking points.',
            negotiation: 'You are a negotiation assistant. Suggest clear strategic responses.',
        }[profile] || 'You are a helpful assistant.';

        return `${profileHint}${customPrompt ? `\n\n${customPrompt}` : ''}`;
    }


    function isLikelyQuestionText(text) {
        const normalized = normalizeSpeechText(text);
        if (!normalized) {
            return false;
        }

        if (normalized.includes('?')) {
            return true;
        }

        const lower = normalized.toLowerCase();
        const questionPattern = /^(what|why|how|when|where|who|which|whom|is|are|am|do|does|did|have|has|had|can|could|would|will|should|may|might)\b/;
        const promptPattern = /^(tell me|explain|describe|walk me through|give me|difference between|what is|what are|how would|why do)\b/;

        return questionPattern.test(lower) || promptPattern.test(lower);
    }

    function pushHistory(userText, assistantText) {
        state.history.push({ userText, assistantText });
        if (state.history.length > 10) {
            state.history = state.history.slice(-10);
        }
    }

    async function processSpeechQueue() {
        if (state.processingSpeechQueue) {
            return;
        }

        state.processingSpeechQueue = true;
        try {
            while (state.speechQueue.length > 0) {
                const nextText = state.speechQueue.shift();
                if (!nextText) {
                    continue;
                }
                await sendTextMessage(nextText);
            }
        } finally {
            state.processingSpeechQueue = false;
        }
    }

    function enqueueSpeechText(text) {
        const normalized = normalizeSpeechText(text);
        if (!normalized) {
            return;
        }

        if (!isLikelyQuestionText(normalized)) {
            console.log('[Web] Skipping non-question speech segment:', normalized);
            return;
        }

        state.speechQueue.push(normalized);
        processSpeechQueue().catch(error => {
            console.error('[Web] Speech queue processing failed:', error);
        });
    }

    function flushAutomaticSpeech() {
        clearSpeechFlushTimer();
        const text = normalizeSpeechText(state.speechAutoBuffer);
        state.speechAutoBuffer = '';
        if (!text) {
            return;
        }
        enqueueSpeechText(text);
    }

    function flushManualSpeech() {
        clearSpeechFlushTimer();
        const text = normalizeSpeechText(state.speechManualBuffer);
        state.speechManualBuffer = '';
        if (!text) {
            return;
        }
        enqueueSpeechText(text);
    }

    function destroySpeechRecognition() {
        clearSpeechFlushTimer();
        state.speechShouldRestart = false;
        state.speechAutoBuffer = '';
        state.speechManualBuffer = '';

        const recognition = state.speechRecognition;
        state.speechRecognition = null;
        state.speechRecognitionActive = false;

        if (!recognition) {
            return;
        }

        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
            recognition.stop();
        } catch (error) {
            // Ignore stop errors from browser speech API state machine
        }
    }

    function startSpeechRecognition() {
        if (state.mode !== 'interview' || !getVadEnabled()) {
            destroySpeechRecognition();
            return true;
        }

        const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
        if (!SpeechRecognitionCtor) {
            setStatus('Speech recognition is not supported in this browser');
            return false;
        }

        if (!state.speechRecognition) {
            state.speechRecognition = new SpeechRecognitionCtor();
        }

        const recognition = state.speechRecognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = state.language || 'en-US';
        recognition.maxAlternatives = 1;
        state.speechShouldRestart = true;
        recognition.onstart = () => {
            if (state.microphoneEnabled) {
                setStatus('Listening...');
            }
        };

        recognition.onresult = event => {
            if (!state.microphoneEnabled) {
                return;
            }

            const vadMode = getVadMode();
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const result = event.results[i];
                const transcript = normalizeSpeechText(result?.[0]?.transcript || '');
                if (!transcript) {
                    continue;
                }

                if (!result.isFinal) {
                    continue;
                }

                if (vadMode === 'manual') {
                    state.speechManualBuffer = normalizeSpeechText(`${state.speechManualBuffer} ${transcript}`);
                    continue;
                }

                state.speechAutoBuffer = normalizeSpeechText(`${state.speechAutoBuffer} ${transcript}`);
                clearSpeechFlushTimer();
                state.speechFlushTimer = setTimeout(() => {
                    flushAutomaticSpeech();
                }, AUTO_SPEECH_FLUSH_MS);
            }
        };

        recognition.onerror = event => {
            const error = event?.error || 'unknown';
            if (error === 'not-allowed' || error === 'service-not-allowed') {
                setStatus('Microphone permission denied');
                state.speechShouldRestart = false;
                return;
            }
            if (error === 'audio-capture') {
                setStatus('No microphone detected');
                state.speechShouldRestart = false;
                return;
            }
            if (error === 'language-not-supported') {
                console.warn('[Web] Speech language not supported, falling back to en-US');
                recognition.lang = 'en-US';
            }

            if (error !== 'no-speech' && error !== 'aborted') {
                console.warn('[Web] Speech recognition error:', error);
            }
        };

        recognition.onend = () => {
            state.speechRecognitionActive = false;
            if (!state.speechShouldRestart) {
                return;
            }
            setTimeout(() => {
                if (state.speechShouldRestart) {
                    startSpeechRecognition();
                }
            }, 250);
        };

        if (state.speechRecognitionActive) {
            return true;
        }

        try {
            recognition.start();
            state.speechRecognitionActive = true;
            return true;
        } catch (error) {
            // "InvalidStateError" means recognition is already running; treat as success.
            if (error && error.name === 'InvalidStateError') {
                state.speechRecognitionActive = true;
                return true;
            }
            console.warn('[Web] Failed to start speech recognition:', error);
            return false;
        }
    }

    async function requestGemini(text, imageBase64) {
        const apiKey = (localStorage.getItem('apiKey') || '').trim();
        if (!apiKey) {
            throw new Error('Missing Gemini API key');
        }

        const model = state.model || 'gemini-2.5-flash';
        const settings = getGenerationSettings(model);
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const contents = [];
        for (const turn of state.history) {
            contents.push({ role: 'user', parts: [{ text: turn.userText }] });
            contents.push({ role: 'model', parts: [{ text: turn.assistantText }] });
        }

        const userParts = [{ text: `${text}${getLanguageInstruction()}`.trim() }];
        if (imageBase64) {
            userParts.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBase64,
                },
            });
        }
        contents.push({ role: 'user', parts: userParts });

        const body = {
            systemInstruction: {
                parts: [{ text: buildSystemPrompt() }],
            },
            contents,
            generationConfig: {
                temperature: settings.temperature,
                topP: settings.topP,
                maxOutputTokens: settings.maxOutputTokens,
            },
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            let details = '';
            try {
                const parsed = await response.json();
                details = parsed.error?.message || JSON.stringify(parsed);
            } catch (error) {
                details = await response.text();
            }
            throw new Error(`Gemini request failed (${response.status}): ${details}`);
        }

        const parsed = await response.json();
        const parts = parsed.candidates?.[0]?.content?.parts || [];
        const answer = parts
            .map(part => part.text || '')
            .join('\n')
            .trim();

        if (!answer) {
            throw new Error('Gemini returned an empty response');
        }

        pushHistory(text, answer);
        return answer;
    }

    async function requestGroq(text, imageBase64) {
        const apiKey = (localStorage.getItem('groqApiKey') || '').trim();
        if (!apiKey) {
            throw new Error('Missing Groq API key');
        }

        const model = state.model || 'llama-4-maverick';
        const modelId = GROQ_MODEL_IDS[model];
        if (!modelId) {
            throw new Error(`Unsupported Groq model: ${model}`);
        }

        const settings = getGenerationSettings(model);
        const messages = [{ role: 'system', content: buildSystemPrompt() }];

        for (const turn of state.history) {
            messages.push({ role: 'user', content: turn.userText });
            messages.push({ role: 'assistant', content: turn.assistantText });
        }

        const finalText = `${text}${getLanguageInstruction()}`.trim();
        if (imageBase64) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: finalText },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                ],
            });
        } else {
            messages.push({ role: 'user', content: finalText });
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                temperature: settings.temperature,
                top_p: settings.topP,
                max_tokens: settings.maxOutputTokens,
                stream: true,
            }),
        });

        if (!response.ok) {
            let details = '';
            try {
                const parsed = await response.json();
                details = parsed.error?.message || JSON.stringify(parsed);
            } catch (error) {
                details = await response.text();
            }
            throw new Error(`Groq request failed (${response.status}): ${details}`);
        }

        if (!response.body) {
            throw new Error('Groq response stream is not available');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';
        let completeText = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }

            streamBuffer += decoder.decode(value, { stream: true });
            const lines = streamBuffer.split('\n');
            streamBuffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) {
                    continue;
                }

                const payload = line.slice(6).trim();
                if (payload === '[DONE]') {
                    continue;
                }

                try {
                    const parsed = JSON.parse(payload);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) {
                        completeText += delta;
                        setResponse(completeText);
                    }
                } catch (error) {
                    // ignore malformed chunks
                }
            }
        }

        const answer = completeText.trim();
        if (!answer) {
            throw new Error('Groq returned an empty response');
        }

        pushHistory(text, answer);
        return answer;
    }

    async function sendMessageInternal(text, imageBase64) {
        if (!state.initialized) {
            throw new Error('Session not initialized');
        }

        setStatus(imageBase64 ? 'Analyzing...' : 'Thinking...');

        let responseText = '';
        if (isGeminiModel(state.model)) {
            responseText = await requestGemini(text, imageBase64);
        } else if (isGroqModel(state.model)) {
            responseText = await requestGroq(text, imageBase64);
        } else {
            throw new Error(`Unsupported model: ${state.model}`);
        }

        setResponse(responseText);
        setStatus(state.mode === 'interview' ? 'Listening...' : 'Ready');
        return responseText;
    }

    async function initializeGemini(profile = 'interview', language = 'en-US', mode = 'interview', model = 'llama-4-maverick') {
        state.profile = profile;
        state.language = language;
        state.mode = mode;
        state.model = model || localStorage.getItem('selectedModel') || 'llama-4-maverick';
        state.history = [];

        const hasGeminiKey = Boolean((localStorage.getItem('apiKey') || '').trim());
        const hasGroqKey = Boolean((localStorage.getItem('groqApiKey') || '').trim());

        if (isGeminiModel(state.model) && !hasGeminiKey) {
            throw new Error('Missing Gemini API key');
        }
        if (isGroqModel(state.model) && !hasGroqKey) {
            throw new Error('Missing Groq API key');
        }
        if (!isGeminiModel(state.model) && !isGroqModel(state.model)) {
            throw new Error(`Unsupported model: ${state.model}`);
        }

        const vadMode = getVadMode();
        state.microphoneEnabled = mode === 'interview' && getVadEnabled() ? vadMode === 'automatic' : false;
        state.initialized = true;
        setStatus(mode === 'interview' ? 'Listening...' : 'Ready');

        if (state.mediaStream) {
            if (mode === 'interview' && getVadEnabled()) {
                const micGranted = await ensureMicrophoneAccess();
                if (micGranted) {
                    startSpeechRecognition();
                }
            } else {
                destroySpeechRecognition();
                releaseMicrophoneAccess();
            }
        }

        return true;
    }

    async function startCapture(screenshotIntervalSeconds = 'manual', imageQuality = 'medium') {
        state.imageQuality = imageQuality || 'medium';

        if (state.screenshotInterval) {
            clearInterval(state.screenshotInterval);
            state.screenshotInterval = null;
        }

        if (state.mediaStream) {
            stopCapture();
        }

        try {
            state.mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            });

            const [videoTrack] = state.mediaStream.getVideoTracks();
            if (videoTrack) {
                videoTrack.addEventListener('ended', () => {
                    stopCapture();
                    setStatus('Capture stopped');
                });
            }

            if (screenshotIntervalSeconds !== 'manual' && screenshotIntervalSeconds !== 'Manual') {
                const everyMs = Math.max(1, parseInt(screenshotIntervalSeconds, 10)) * 1000;
                state.screenshotInterval = setInterval(() => {
                    captureManualScreenshot(state.imageQuality).catch(err => {
                        console.error('[Web] Auto screenshot failed:', err);
                    });
                }, everyMs);
            }

            if (state.mode === 'interview' && getVadEnabled()) {
                state.microphoneEnabled = getVadMode() === 'automatic';
                const micGranted = await ensureMicrophoneAccess();
                const speechStarted = micGranted ? startSpeechRecognition() : false;
                if (!speechStarted) {
                    console.warn('[Web] Voice auto-submit unavailable in this browser');
                }
            } else {
                destroySpeechRecognition();
                state.microphoneEnabled = false;
                releaseMicrophoneAccess();
                if (state.mode === 'interview' && !getVadEnabled()) {
                    setStatus('Voice capture is disabled in settings (enable VAD)');
                }
            }
        } catch (error) {
            setStatus('Screen capture permission denied');
            console.error('[Web] startCapture failed:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    }

    function stopCapture() {
        destroySpeechRecognition();
        state.speechQueue = [];
        state.processingSpeechQueue = false;

        if (state.screenshotInterval) {
            clearInterval(state.screenshotInterval);
            state.screenshotInterval = null;
        }

        if (state.hiddenVideo) {
            state.hiddenVideo.pause();
            state.hiddenVideo.srcObject = null;
        }
        state.hiddenVideo = null;
        state.offscreenCanvas = null;
        state.offscreenContext = null;

        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach(track => track.stop());
            state.mediaStream = null;
        }

        releaseMicrophoneAccess();
    }

    async function sendTextMessage(text) {
        if (!text || !text.trim()) {
            return { success: false, error: 'Empty message' };
        }

        try {
            let imageBase64 = null;
            if (state.mediaStream) {
                try {
                    imageBase64 = await getScreenshotBase64(state.imageQuality);
                } catch (error) {
                    console.warn('[Web] Screenshot capture failed, sending text-only:', error.message);
                }
            }
            await sendMessageInternal(text.trim(), imageBase64);
            return { success: true };
        } catch (error) {
            console.error('[Web] sendTextMessage failed:', error);
            setStatus(`Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async function captureManualScreenshot(imageQuality = null) {
        try {
            if (!state.mediaStream) {
                return { success: false, error: 'No active screen capture stream' };
            }

            const selectedProfile = localStorage.getItem('selectedProfile') || state.profile || 'interview';
            const prompt = SCREENSHOT_PROMPTS[selectedProfile] || SCREENSHOT_PROMPTS.interview;
            const base64 = await getScreenshotBase64(imageQuality || state.imageQuality);
            await sendMessageInternal(prompt, base64);
            return { success: true };
        } catch (error) {
            console.error('[Web] captureManualScreenshot failed:', error);
            setStatus(`Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    function handleShortcut(shortcutKey) {
        const app = getAppElement();
        if (!app) {
            return;
        }
        const currentView = app.currentView;

        if (shortcutKey === 'ctrl+enter' || shortcutKey === 'cmd+enter') {
            if (currentView === 'main') {
                if (typeof app.handleStart === 'function') {
                    app.handleStart();
                }
            } else {
                captureManualScreenshot().catch(error => {
                    console.error('[Web] Shortcut screenshot failed:', error);
                });
            }
        }
    }

    async function toggleMicrophone(enabled) {
        state.microphoneEnabled = Boolean(enabled);

        if (state.mode === 'interview' && getVadEnabled()) {
            if (state.microphoneEnabled) {
                const micGranted = await ensureMicrophoneAccess();
                if (!micGranted) {
                    state.microphoneEnabled = false;
                    return { success: false, enabled: false, error: 'Microphone permission denied' };
                }
            }
            startSpeechRecognition();
            if (getVadMode() === 'manual') {
                if (state.microphoneEnabled) {
                    state.speechManualBuffer = '';
                    setStatus('Listening...');
                } else {
                    flushManualSpeech();
                }
            }
        }

        return { success: true, enabled: state.microphoneEnabled };
    }

    window.captureManualScreenshot = captureManualScreenshot;

    const cheddar = {
        element: () => getAppElement(),
        e: () => getAppElement(),
        app: null,
        getCurrentView: () => getAppElement()?.currentView || 'main',
        getLayoutMode: () => getAppElement()?.layoutMode || 'compact',
        setStatus,
        setResponse,
        initializeGemini,
        startCapture,
        stopCapture,
        sendTextMessage,
        handleShortcut,
        toggleMicrophone,
        getContentProtection: () => {
            const contentProtection = localStorage.getItem('contentProtection');
            return contentProtection !== null ? contentProtection === 'true' : true;
        },
        isLinux: isLinux(),
        isMacOS: isMac(),
    };

    window.cheddar = cheddar;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            cheddar.app = getAppElement();
        }, 100);

        document.addEventListener('keydown', event => {
            const mac = isMac();
            const captureShortcut = mac ? event.metaKey && event.key === 'Enter' : event.ctrlKey && event.key === 'Enter';
            if (!captureShortcut) {
                return;
            }
            event.preventDefault();
            handleShortcut(mac ? 'cmd+enter' : 'ctrl+enter');
        });

        window.addEventListener('storage', async event => {
            if (event.key === 'selectedLanguage') {
                state.language = event.newValue || state.language;
                if (state.speechRecognition) {
                    state.speechRecognition.lang = state.language || 'en-US';
                }
                return;
            }

            if (event.key === 'vadEnabled' || event.key === 'vadMode') {
                if (state.mode === 'interview' && getVadEnabled()) {
                    state.microphoneEnabled = getVadMode() === 'automatic';
                    const micGranted = await ensureMicrophoneAccess();
                    if (micGranted) {
                        startSpeechRecognition();
                    }
                } else {
                    destroySpeechRecognition();
                    releaseMicrophoneAccess();
                    state.microphoneEnabled = false;
                }
            }
        });
    });
})();

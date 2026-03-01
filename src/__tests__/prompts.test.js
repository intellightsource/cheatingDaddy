const {
    getSystemPrompt,
    getCondensedSystemPrompt,
    getGeminiMessageHint,
    profilePrompts,
} = require('../utils/prompts');

describe('Prompt System Tests', () => {
    describe('Profile Prompts', () => {
        it('has all required profiles', () => {
            const requiredProfiles = ['interview', 'exam', 'sales', 'meeting', 'presentation', 'negotiation'];

            requiredProfiles.forEach(profile => {
                expect(profilePrompts[profile]).toBeDefined();
                expect(profilePrompts[profile].intro).toBeDefined();
                expect(profilePrompts[profile].formatRequirements).toBeDefined();
                expect(profilePrompts[profile].content).toBeDefined();
                expect(profilePrompts[profile].outputInstructions).toBeDefined();
            });
        });

        it('exam profile still enforces comment-free code', () => {
            const fullPrompt = (
                profilePrompts.exam.intro +
                profilePrompts.exam.content +
                profilePrompts.exam.outputInstructions
            ).toUpperCase();

            expect(fullPrompt).toContain('COMMENT-FREE');
            expect(fullPrompt).toContain('ZERO TOLERANCE');
            expect(fullPrompt).toContain('NO EXCEPTIONS');
        });
    });

    describe('Interview Prompt Generation', () => {
        it('generates a short plain-text interview prompt', () => {
            const prompt = getSystemPrompt('interview', '', true);

            expect(prompt).toContain('plain text only');
            expect(prompt).toContain('Use native spoken English with easy words');
            expect(prompt).toContain('The first sentence must be a short summary with the core answer');
            expect(prompt).toContain('After the first sentence, add 3-4 short follow-up sentences');
        });

        it('avoids the old five-section coding template by default', () => {
            const prompt = getSystemPrompt('interview', '', true);

            expect(prompt).not.toContain('Approach: [Name]');
            expect(prompt).not.toContain('FULL 5-SECTION');
            expect(prompt).not.toContain('MANDATORY 5-SECTION FORMAT');
        });

        it('keeps coding answers code-first with exact signature preservation', () => {
            const prompt = getSystemPrompt('interview', '', true);

            expect(prompt).toContain('Solve immediately and put the code first');
            expect(prompt).toContain('Preserve the exact function signature');
            expect(prompt).toContain('Never change parameter names');
        });

        it('includes custom prompt when provided', () => {
            const customPrompt = 'Focus on Python solutions';
            const prompt = getSystemPrompt('interview', customPrompt, true);

            expect(prompt).toContain(customPrompt);
        });

        it('includes search guidance only when enabled', () => {
            const promptWithSearch = getSystemPrompt('interview', '', true);
            const promptWithoutSearch = getSystemPrompt('interview', '', false);

            expect(promptWithSearch).toContain('SEARCH TOOL USAGE');
            expect(promptWithoutSearch).not.toContain('SEARCH TOOL USAGE');
        });

        it('defaults unknown profiles to the fast interview prompt', () => {
            const unknownPrompt = getSystemPrompt('unknown-profile', '', true);
            const interviewPrompt = getSystemPrompt('interview', '', true);

            expect(unknownPrompt).toBe(interviewPrompt);
        });

        it('uses the same plain-text strategy for condensed Groq prompts', () => {
            const prompt = getCondensedSystemPrompt('interview', 'Use Java');

            expect(prompt).toContain('plain text only');
            expect(prompt).toContain('Use Java');
            expect(prompt).not.toContain('Approach: [Name]');
        });
    });

    describe('Gemini Interview Hints', () => {
        it('keeps text-only interview hints short and plain text', () => {
            const hint = getGeminiMessageHint(false, 'interview');

            expect(hint).toContain('First sentence: short summary with the core answer');
            expect(hint).toContain('Then add 3-4 short follow-up sentences');
            expect(hint).toContain('No markdown emphasis');
            expect(hint).not.toContain('FULL 5-SECTION');
        });

        it('keeps screenshot interview hints code-first and unstructured', () => {
            const hint = getGeminiMessageHint(true, 'interview');

            expect(hint).toContain('Return the working code first');
            expect(hint).toContain('Preserve the EXACT function signature');
            expect(hint).toContain('state the key difference in the first sentence');
        });
    });

    describe('Exam Prompt Stability', () => {
        it('exam mode still requires direct answers only', () => {
            const examPrompt = profilePrompts.exam.formatRequirements;

            expect(examPrompt).toContain('MCQ');
            expect(examPrompt).toContain('NO explanations');
            expect(examPrompt).toContain('ONLY the final answer');
        });
    });
});

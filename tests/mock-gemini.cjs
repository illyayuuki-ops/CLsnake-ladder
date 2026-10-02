const originalFetch = global.fetch;
const fakeRiddle = {
  haiku: "Silver moon at night\nSoftly lights the sleeping sea\nTides pull at the shore",
  answer: "moon",
  acceptedAnswers: ["luna"],
};

global.fetch = async (input, options = {}) => {
  if (!String(input).startsWith("https://generativelanguage.googleapis.com/")) return originalFetch(input, options);
  if (options.headers?.["x-goog-api-key"] !== "test-gemini-key") {
    return { ok: false, status: 401, json: async () => ({ error: { message: "Missing test key." } }) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(fakeRiddle) }] } }] }),
  };
};

const dieSequence = [6, 1, 6, 1, 5, 1, 1, 6, 1, 6, 1, 5, 1, 1];
let dieIndex = 0;
if (globalThis.crypto?.getRandomValues) {
  globalThis.crypto.getRandomValues = values => {
    values[0] = ((dieSequence[dieIndex++] || 1) - 1) >>> 0;
    return values;
  };
}

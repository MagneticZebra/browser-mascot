import { IDLE, MOODS } from './moods.js';

export const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';

/** Below this probability the mascot does not commit to a reaction. */
const MIN_PROBABILITY = 0.3;
/** A new mood has to beat the current one by this much, so the mascot does not flicker. */
const STICKINESS = 0.1;

const INSTRUCTIONS =
  "A small mascot sits in the corner of the user's browser and reacts to what the user is doing. " +
  'From the browsing state, choose the one reaction that fits this moment best.';

/** One Choice question: which of the moods this avatar can draw fits `state`. */
export function buildRequest(state, poseNames, model = JEV_MODEL) {
  const criteria = {};
  for (const mood of MOODS) {
    if (mood.when && poseNames.includes(mood.id)) criteria[mood.id] = mood.when;
  }
  return {
    model,
    state,
    questions: { mood: { type: 'choice', instructions: INSTRUCTIONS, criteria } },
  };
}

/** Sends the request and returns Jev's Choice answer with what the call cost. */
export async function askJev({ endpoint = JEV_ENDPOINT, key, request }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Jev ${response.status}: ${body?.error?.message ?? response.statusText}`);
  }
  const answer = body?.answers?.mood;
  if (answer?.type !== 'choice' || !(answer.choice in (answer.probabilities ?? {}))) {
    throw new Error(`Jev returned no choice: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return { answer, cost: body.usage?.cost ?? 0 };
}

/** The mood to show next, given Jev's answer and the mood showing now. */
export function pickMood(answer, current) {
  const { choice, probabilities } = answer;
  if (probabilities[choice] < MIN_PROBABILITY) {
    return { id: IDLE, probability: probabilities[IDLE] ?? 0 };
  }
  if (current in probabilities && probabilities[choice] - probabilities[current] < STICKINESS) {
    return { id: current, probability: probabilities[current] };
  }
  return { id: choice, probability: probabilities[choice] };
}

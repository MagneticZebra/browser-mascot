import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRequest, pickMood } from '../extension/jev.js';

test('the request offers only moods the avatar can draw, and never asleep', () => {
  const request = buildRequest({ site: 'reddit.com' }, ['idle', 'cheering', 'asleep', 'idle_alt']);
  assert.deepEqual(Object.keys(request.questions.mood.criteria), ['idle', 'cheering']);
  assert.equal(request.questions.mood.type, 'choice');
  assert.deepEqual(request.state, { site: 'reddit.com' });
  assert.equal(request.model, 'typesafe/jev-1.13');
});

test('a confident choice becomes the mood', () => {
  const answer = { choice: 'cheering', probabilities: { cheering: 0.8, idle: 0.2 } };
  assert.deepEqual(pickMood(answer, 'idle'), { id: 'cheering', probability: 0.8 });
});

test('an unsure choice falls back to idle', () => {
  const answer = { choice: 'grumpy', probabilities: { grumpy: 0.25, shocked: 0.2, idle: 0.15, cool: 0.2 } };
  assert.deepEqual(pickMood(answer, 'cool'), { id: 'idle', probability: 0.15 });
});

test('the current mood stays unless the new one clearly beats it', () => {
  const answer = { choice: 'curious', probabilities: { curious: 0.45, cool: 0.4, idle: 0.15 } };
  assert.deepEqual(pickMood(answer, 'cool'), { id: 'cool', probability: 0.4 });
  assert.deepEqual(pickMood(answer, 'idle'), { id: 'curious', probability: 0.45 });
});

test('a mood Jev was not asked about, such as asleep, never sticks', () => {
  const answer = { choice: 'curious', probabilities: { curious: 0.45, idle: 0.45 } };
  assert.equal(pickMood(answer, 'asleep').id, 'curious');
});

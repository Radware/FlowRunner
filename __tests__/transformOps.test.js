import { describe, test, expect } from '@jest/globals';
import { executeTransformOps } from '../transformOps.js';

const simpleEvaluatePath = (data, path) => {
    if (!path) return undefined;
    const tokens = path.split('.').filter(Boolean);
    let current = data;
    for (const token of tokens) {
        if (current == null) return undefined;
        current = current[token];
    }
    return current;
};

describe('transformOps', () => {
    test('base64 encode/decode round-trip (base64url)', async () => {
        const context = {};
        const ops = [
            { op: 'base64_encode', set: 'b64', args: ['hello'], options: { base64: 'url' } },
            { op: 'base64_decode', set: 'text', args: [{ ref: 'b64' }], options: { base64: 'url', as: 'text' } }
        ];
        await executeTransformOps(ops, context, { evaluatePath: simpleEvaluatePath });
        expect(context.text).toBe('hello');
    });

    test('jwt encode/decode round-trip', async () => {
        const context = {
            header: { alg: 'none', typ: 'JWT' },
            payload: { sub: 'user1', exp: 123 }
        };
        const ops = [
            { op: 'jwt_encode', set: 'token', args: [{ ref: 'header' }, { ref: 'payload' }, ''], options: { signatureMode: 'none', base64: 'url' } },
            { op: 'jwt_decode', set: 'decoded', args: [{ ref: 'token' }], options: { base64: 'url', stripBearer: 'false' } }
        ];
        await executeTransformOps(ops, context, { evaluatePath: simpleEvaluatePath });
        expect(context.decoded.payload.exp).toBe(123);
        expect(context.decoded.header.alg).toBe('none');
    });
});

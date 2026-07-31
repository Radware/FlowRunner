/**
 * compareVersions must order prerelease builds below their GA release so that
 * beta installs (e.g. 1.5.0-beta.1) are notified when the stable version ships,
 * while never nagging them to "upgrade" to an older stable release.
 */
import { compareVersions } from '../appFeatures.js';

describe('compareVersions', () => {
    test('plain releases compare numerically', () => {
        expect(compareVersions('1.5.0', '1.4.1')).toBe(1);
        expect(compareVersions('1.4.1', '1.5.0')).toBe(-1);
        expect(compareVersions('1.2.1', '1.2.1')).toBe(0);
        expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    });

    test('missing segments count as zero', () => {
        expect(compareVersions('1.5', '1.5.0')).toBe(0);
        expect(compareVersions('1.5.1', '1.5')).toBe(1);
    });

    test('an older stable never outranks a newer prerelease (no downgrade nag)', () => {
        expect(compareVersions('1.4.1', '1.5.0-beta.1')).toBe(-1);
    });

    test('the GA release outranks its own prereleases (beta users get the update prompt)', () => {
        expect(compareVersions('1.5.0', '1.5.0-beta.1')).toBe(1);
        expect(compareVersions('1.5.0-beta.1', '1.5.0')).toBe(-1);
    });

    test('prerelease sequences order numerically and lexically', () => {
        expect(compareVersions('1.5.0-beta.2', '1.5.0-beta.1')).toBe(1);
        expect(compareVersions('1.5.0-beta.1', '1.5.0-beta.1')).toBe(0);
        expect(compareVersions('1.5.0-beta.10', '1.5.0-beta.9')).toBe(1);
        expect(compareVersions('1.5.0-rc.1', '1.5.0-beta.2')).toBe(1);
        expect(compareVersions('1.5.0-beta', '1.5.0-beta.1')).toBe(-1);
    });
});

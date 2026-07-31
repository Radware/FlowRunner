// electron-builder afterPack hook (build-time only — NOT part of build.files).
//
// Why: the stock Electron launcher stub ships with only a bare linker ad-hoc
// signature, identical bytes in every unsigned Electron app of that version.
// Apple's notarization service revoked the Electron 31.7.7 stub's cdhash
// (malware campaigns shipped on the same stub), so any app that keeps it is
// launch-blocked on current macOS as "contains malware" — regardless of
// quarantine. A deep ad-hoc re-sign generates fresh cdhashes, off the
// deny-list, restoring the normal unsigned-app behavior. See gotchas.md 2p.
//
// Replace with real Developer ID signing + notarization at GA.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);
    console.log(`  • afterPack: deep ad-hoc re-sign ${appPath}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', appPath], { stdio: 'inherit' });
};

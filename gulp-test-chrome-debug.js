const { series } = require('gulp');
const del = require('del');
const run = require('gulp-run-command').default;
const fs = require('fs');

/**
 * Run a command in the vscode-chrome-debug working directory
 */
function runInDebug(cmd) {
    return run(cmd, { cwd: './vscode-chrome-debug' })();
}

/**
 * Delete the vscode-chrome-debug working directory (if it exists)
 */
function clean(done) {
    // using sync because async del doesn't report failures correctly, can can cause hangs
    del.sync(['vscode-chrome-debug']);
    done();
}

/**
 * Clone the vscode-chrome-debug project from GitHub
 */
function clone() {
    return run('git clone -b v2 --single-branch --depth 1 https://github.com/Microsoft/vscode-chrome-debug.git')();
}

/**
 * Run `npm install` on vscode-chrome-debug
 */
function install() {
    return runInDebug('npm install');
}

/**
 * Substitute our version of -core for the tests
 */
function setCoreVersion(cb) {
    const packageJsonPath = './vscode-chrome-debug/package.json';
    const originalPackageJson = fs.readFileSync(packageJsonPath);
    let modifiedPackageJson = JSON.parse(originalPackageJson);
    modifiedPackageJson.dependencies['vscode-chrome-debug-core'] = '../';
    fs.writeFileSync(packageJsonPath, JSON.stringify(modifiedPackageJson));
    cb();
}

/**
 * Build vscode-chrome-debug
 */
function build() {
    return runInDebug('npm run build');
}

/**
 * Run the integration tests for vscode-chrome-debug
 */
function intTest() {
    return runInDebug('npm run allIntTest', {cwd: './vscode-chrome-debug/'});
}

exports.clean = clean;
exports.clone = clone;
exports.install = install;
exports.setCoreVersion = setCoreVersion;
exports.build = build;
exports.intTest = intTest;

/**
 * This task will check out vscode-chrome-debug from source, modify it to use this version of -core, and run
 * the integration tests against it to ensure that nothing broke.
 */
exports.testChromeDebug = series(
    clean,
    clone,
    setCoreVersion,
    install,
    build,
    intTest
);
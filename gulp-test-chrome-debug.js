const { series } = require('gulp');
const del = require('del');
const { exec } = require('child_process');
const run = require('gulp-run-command').default;

const CHROME_DEBUG_V2_PATH = './vscode-chrome-debug';
const CHROME_DEBUG_ZIP_PATH = './vscode-chrome-debug-v2.zip';

const IS_WINDOWS = (process.platform == 'win32');


function getModifiedPathEnv() {
    let env = process.env;
    env.path = `C:\\Program Files\\Git\\mingw64\\bin\\;${env.path}`;
    return env;
}

/**
 * Run using exec for windows. This seems to solve the problems with git/paths
 */
function runWindows(cmd, options) {
    return new Promise((accept, reject) => {
        const child = exec(cmd, options, (err, _stdout, _stderr) => {

            if(err)
                reject(err);
            else
                accept();
        });

        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);
    });
}

/**
 * Run a command in the vscode-chrome-debug working directory
 */
function runInChromeDebug(cmd, options = {}) {
    if(IS_WINDOWS) {
        return runWindows(cmd, { cwd: CHROME_DEBUG_V2_PATH, ...options });
    }
    else {
        return run(cmd, { cwd: CHROME_DEBUG_V2_PATH, ...options })();
    }
}

/**
 * Delete the vscode-chrome-debug working directory (if it exists)
 */
function clean(done) {
    // using sync because async del doesn't report failures correctly, can can cause hangs
    del.sync([CHROME_DEBUG_ZIP_PATH, CHROME_DEBUG_V2_PATH]);
    done();
}

/**
 * Clone the vscode-chrome-debug project from GitHub
 */
async function clone() {
    if(IS_WINDOWS) {
        return runWindows('C:\\Progra~1\\Git\\bin\\git.exe clone -b v2 --single-branch --depth 1 https://github.com/Microsoft/vscode-chrome-debug', { env: getModifiedPathEnv() });
    }
    else {
        return run('git clone -b v2 --single-branch --depth 1 https://github.com/Microsoft/vscode-chrome-debug')();
    }
}

/**
 * Run `npm install` on vscode-chrome-debug
 */
function install() {
    if(IS_WINDOWS)
        return runInChromeDebug('npm install', { env: getModifiedPathEnv() });
    else
        return runInChromeDebug('npm install');
}

/**
 * Substitute our version of -core for the tests
 */
async function linkChromeDebugCore() {
    await run('npm link')();
    return runInChromeDebug('npm link vscode-chrome-debug-core');
}

/**
 * Build vscode-chrome-debug
 */
function build() {
    return runInChromeDebug('npm run build');
}

/**
 * Run the integration tests for vscode-chrome-debug
 */
function intTest() {
    return runInChromeDebug('npm run allIntTest', {cwd: './vscode-chrome-debug/'});
}

/**
 * This task will check out vscode-chrome-debug from source, modify it to use this version of -core, and run
 * the integration tests against it to ensure that nothing broke.
 */
exports.testChromeDebug = series(
    clean,
    clone,
    install,
    linkChromeDebugCore,
    build,
    intTest
);
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

const gulp = require('gulp');
const path = require('path');
const ts = require('gulp-typescript');
const log = require('gulp-util').log;
const typescript = require('typescript');
const sourcemaps = require('gulp-sourcemaps');
const mocha = require('gulp-mocha');
const tslint = require('gulp-tslint');
const merge = require('merge2');
const debug = require('gulp-debug');
const del = require('del');
const plumber = require('gulp-plumber');
const crdp = require('chrome-remote-debug-protocol');
const nls = require('vscode-nls-dev');
const es = require('event-stream');
const runSequence = require('run-sequence');

const transifexApiHostname = 'www.transifex.com'
const transifexApiName = 'api';
const transifexApiToken = process.env.TRANSIFEX_API_TOKEN;
const transifexProjectName = 'vscode-extensions';
const transifexExtensionName = 'vscode-chrome-debug-core';
const vscodeLanguages = [
    'zh-hans',
    'zh-hant',
    'ja',
    'ko',
    'de',
    'fr',
    'es',
    'ru',
    'it',
    'pt-br',
    'hu',
    'tr'
];

const tsconfig = require('./tsconfig.json');
const sources = tsconfig.include;

const libs = [
    'src',
    'crdp'
].map(libFolder => libFolder + '/**/*.d.ts');

const lintSources = [
    'src',
    'test'
].map(tsFolder => tsFolder + '/**/*.ts');

// tsBuildSources needs to explicitly exclude testData because it's built and copied separately.
const testDataDir = 'test/**/testData/';
const tsBuildSources = sources.slice();
const exclusion = '!' + testDataDir + '**';
tsBuildSources.push(exclusion);
lintSources.push(exclusion);

function doBuild(buildNls) {
    const tsProject = ts.createProject('tsconfig.json', { typescript });
    const tsResult = gulp.src(tsBuildSources, { base: '.' })
        .pipe(plumber())
        .pipe(sourcemaps.init())
        .pipe(ts(tsProject));

    return merge([
        tsResult.dts
            .pipe(gulp.dest('lib')),
        tsResult.js
            .pipe(buildNls ? nls.rewriteLocalizeCalls() : es.through())
            .pipe(buildNls ? nls.createAdditionalLanguageFiles(nls.coreLanguages, 'i18n', 'out') : es.through())

            // .. to compensate for TS returning paths from 'out'
            .pipe(sourcemaps.write('.', { includeContent: true, sourceRoot: '..' }))
            .pipe(gulp.dest('out')),
        gulp.src(libs, { base: '.' })
            .pipe(gulp.dest('lib')),
        gulp.src(testDataDir + 'app*', { base: '.' })
            .pipe(gulp.dest('out'))
    ]);
}

gulp.task('build', () => {
    return doBuild(true);
});

gulp.task('dev-build', () => {
    return doBuild(false);
});

gulp.task('clean', () => {
    return del(['out', 'lib']);
});

gulp.task('watch', ['dev-build'], () => {
    log('Watching build sources...');
    return gulp.watch(sources, ['dev-build']);
});

gulp.task('default', ['build']);

gulp.task('tslint', () => {
      return gulp.src(lintSources, { base: '.' })
        .pipe(tslint())
        .pipe(tslint.report());
});

gulp.task('transifex-push', function () {
    return gulp.src(['**/*.nls.json', '!testSupport/**'])
        .pipe(nls.prepareXlfFiles(transifexProjectName, transifexExtensionName))
        .pipe(nls.pushXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken));
});

gulp.task('transifex-pull', function () {
    return nls.pullXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken, vscodeLanguages, [{ name: transifexExtensionName, project: transifexProjectName }])
        .pipe(gulp.dest(`../${transifexExtensionName}-localization`));
});

gulp.task('i18n-import', function () {
    return gulp.src(`../${transifexExtensionName}-localization/**/*.xlf`)
        .pipe(nls.prepareJsonFiles())
        .pipe(gulp.dest('./i18n'));
});

function test() {
    return gulp.src('out/test/**/*.test.js', { read: false })
        .pipe(mocha({ ui: 'tdd' }))
        .on('error', e => {
            log(e ? e.toString() : 'error in test task!');
            this.emit('end');
        });
}

gulp.task('dev-build-test', ['dev-build'], test);
gulp.task('test', test);

gulp.task('watch-build-test', ['dev-build', 'dev-build-test'], () => {
    return gulp.watch(sources, ['dev-build', 'dev-build-test']);
});

gulp.task('regenerate-crdp', cb => {
    crdp.downloadAndGenerate(path.join(__dirname, 'crdp/crdp.d.ts'))
        .then(cb);
});

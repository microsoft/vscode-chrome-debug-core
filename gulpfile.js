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
const nls = require('vscode-nls-dev');
const es = require('event-stream');
const runSequence = require('run-sequence');

const transifexApiHostname = 'www.transifex.com'
const transifexApiName = 'api';
const transifexApiToken = process.env.TRANSIFEX_API_TOKEN;
const transifexProjectName = 'vscode-extensions';
const transifexExtensionName = 'vscode-chrome-debug-core';

const defaultLanguages = [
    { id: 'zh-tw', folderName: 'cht', transifexId: 'zh-hant' },
    { id: 'zh-cn', folderName: 'chs', transifexId: 'zh-hans' },
    { id: 'ja', folderName: 'jpn' },
    { id: 'ko', folderName: 'kor' },
    { id: 'de', folderName: 'deu' },
    { id: 'fr', folderName: 'fra' },
    { id: 'es', folderName: 'esn' },
    { id: 'ru', folderName: 'rus' },
    { id: 'it', folderName: 'ita' },
    { id: 'cs', folderName: 'csy' },
    { id: 'tr', folderName: 'trk' },
    { id: 'pt-br', folderName: 'ptb', transifexId: 'pt_BR' },
    { id: 'pl', folderName: 'plk' }
];

const tsconfig = require('./tsconfig.json');
const sources = tsconfig.include;

const libs = [
    'src',
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

function doBuild(buildNls, failOnError) {
    let gotError = false;
    const tsProject = ts.createProject('tsconfig.json', { typescript });
    const tsResult = gulp.src(tsBuildSources, { base: '.' })
        .pipe(plumber())
        .pipe(sourcemaps.init())
        .pipe(tsProject())
        .once('error', () => {
            gotError = true;
        });

    return merge([
        tsResult.dts
            .pipe(gulp.dest('lib')),
        tsResult.js
            .pipe(buildNls ? nls.rewriteLocalizeCalls() : es.through())
            .pipe(buildNls ? nls.createAdditionalLanguageFiles(defaultLanguages, 'i18n', 'out') : es.through())
            .pipe(buildNls ? nls.bundleMetaDataFiles('vscode-chrome-debug-core', 'out') : es.through())
            .pipe(buildNls ? nls.bundleLanguageFiles() : es.through())

            .pipe(sourcemaps.write('.', { includeContent: true, sourceRoot: '.' }))
            .pipe(gulp.dest('out')),
        gulp.src(libs, { base: '.' })
            .pipe(gulp.dest('lib')),
        gulp.src(testDataDir + 'app*', { base: '.' })
            .pipe(gulp.dest('out'))
    ])
        .once('error', () => {
            gotError = true;
        })
        .once('finish', () => {
            if (failOnError && gotError) {
                process.exit(1);
            }
        });
}

gulp.task('build', ['clean'], () => {
    return doBuild(true, true);
});

gulp.task('_dev-build', () => {
    return doBuild(false, false);
});

gulp.task('clean', () => {
    return del(['out', 'lib']);
});

gulp.task('watch', ['clean'], () => {
    log('Watching build sources...');
    return runSequence('_dev-build', () => gulp.watch(sources, ['_dev-build']));
});

gulp.task('default', ['build']);

gulp.task('tslint', () => {
      return gulp.src(lintSources, { base: '.' })
        .pipe(tslint())
        .pipe(tslint.report());
});

gulp.task('transifex-push', ['build'], function () {
    return gulp.src(['out/nls.metadata.header.json', 'out/nls.metadata.json'])
        .pipe(nls.createXlfFiles(transifexProjectName, transifexExtensionName))
        .pipe(nls.pushXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken));
});

gulp.task('transifex-push-test', ['build'], function () {
    return gulp.src(['out/nls.metadata.header.json', 'out/nls.metadata.json'])
        .pipe(nls.createXlfFiles(transifexProjectName, transifexExtensionName))
        .pipe(gulp.dest(path.join('..', `${transifexExtensionName}-push-test`)));
});

gulp.task('transifex-pull', function () {
    return es.merge(defaultLanguages.map(function (language) {
        return nls.pullXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken, language, [{ name: transifexExtensionName, project: transifexProjectName }]).
            pipe(gulp.dest(`../${transifexExtensionName}-localization/${language.folderName}`));
    }));
});

gulp.task('i18n-import', function () {
    return es.merge(defaultLanguages.map(function (language) {
        return gulp.src(`../${transifexExtensionName}-localization/${language.folderName}/**/*.xlf`)
            .pipe(nls.prepareJsonFiles())
            .pipe(gulp.dest(path.join('./i18n', language.folderName)));
    }));
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

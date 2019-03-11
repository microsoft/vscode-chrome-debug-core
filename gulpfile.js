/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

const gulp = require('gulp');
const path = require('path');
const ts = require('gulp-typescript');
const log = require('gulp-util').log;
const typescript = require('typescript');
const sourcemaps = require('gulp-sourcemaps');
const tslint = require('gulp-tslint');
const merge = require('merge2');
const debug = require('gulp-debug');
const del = require('del');
const plumber = require('gulp-plumber');
const nls = require('vscode-nls-dev');
const es = require('event-stream');
const minimist = require('minimist');

const translationProjectName = 'vscode-extensions';
const translationExtensionName = 'vscode-chrome-debug-core';

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
    { id: 'pt-br', folderName: 'ptb', transifexId: 'pt-BR' },
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

gulp.task('clean', () => {
	return del(['out', 'lib']);
});

gulp.task('build', gulp.series('clean', () => {
    return doBuild(true, true);
}));

gulp.task('_dev-build', () => {
    return doBuild(false, false);
});

gulp.task('watch', gulp.series('clean', '_dev-build', () => {
    log('Watching build sources...');
    return gulp.watch(sources, gulp.series('_dev-build'));
}));

gulp.task('tslint', () => {
      return gulp.src(lintSources, { base: '.' })
        .pipe(tslint())
        .pipe(tslint.report());
});

gulp.task('translations-export', gulp.series('build', () => {
    return gulp.src(['out/nls.metadata.header.json','out/nls.metadata.json'])
        .pipe(nls.createXlfFiles(translationProjectName, translationExtensionName))
        .pipe(gulp.dest(path.join('..', 'vscode-translations-export')));
}));

gulp.task('translations-import', (done) => {
    var options = minimist(process.argv.slice(2), {
        string: 'location',
        default: {
            location: '../vscode-translations-import'
        }
    });
    return es.merge(defaultLanguages.map(language => {
        let id = language.transifexId || language.id;
        console.log(path.join(options.location, id, 'vscode-extensions', `${translationExtensionName}.xlf`));
        return gulp.src(path.join(options.location, id, 'vscode-extensions', `${translationExtensionName}.xlf`))
            .pipe(nls.prepareJsonFiles())
            .pipe(gulp.dest(path.join('./i18n', language.folderName)));
    })).on('end', () => done());
});

gulp.task('i18n-import', () => {
    return es.merge(defaultLanguages.map(language => {
        return gulp.src(`../${translationExtensionName}-localization/${language.folderName}/**/*.xlf`)
            .pipe(nls.prepareJsonFiles())
            .pipe(gulp.dest(path.join('./i18n', language.folderName)));
    }));
});

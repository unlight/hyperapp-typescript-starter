/// <reference path="node_modules/typescript/lib/lib.esnext.d.ts" />
/* eslint-disable no-console, import/max-dependencies */
import * as fs from 'fs';
import * as path from 'path';
import { loader } from 'webpack-loader-helper';
import { Configuration, Options, Entry } from 'webpack';
import webpack = require('webpack');
import pick = require('1-liners/pick');
import * as execa from 'execa';
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const pkg = require('./package.json');
const sourcePath = path.join(__dirname, 'src');
const buildPath = path.join(__dirname, 'dist');
const context = __dirname;

const defaultOptions = {
    libs: process.argv.indexOf('--env.libs') !== -1,
    style: process.argv.indexOf('--env.style') !== -1,
    test: false,
    coverage: false,
    prod: process.argv.indexOf('--mode=production') !== -1 || process.argv.indexOf('--env.prod') !== -1,
    get dev(): boolean {
        return !this.prod;
    },
    get hmr(): boolean {
        return this.dev;
    },
    get minimize(): boolean {
        return (process.argv.indexOf('--env.nomin') !== -1) ? false : this.prod;
    },
    get devtool(): string {
        return ('webpack_devtool' in process.env) ? process.env.webpack_devtool : 'cheap-source-map';
    },
    get sourceMap(): boolean {
        const devtool = this.devtool;
        return (!devtool || devtool === '0') ? false : true;
    },
    get mode() {
        return this.prod ? 'production' : 'development';
    }
};

type ConfigOptions = Partial<Record<keyof typeof defaultOptions, any>>;

export = (options: ConfigOptions = {}) => {
    options = { ...defaultOptions, ...options };
    process['traceDeprecation'] = options.dev;
    for (const [key, value] of Object.entries(options)) {
        (value === true) ? process.stdout.write(`${key} `) : (process.stdout.write(value ? `${key}:${value} ` : ''));
    }
    const stats: Options.Stats = {
        version: false,
        maxModules: 0,
        children: false,
    };
    const watchOptions = {
        ignored: /node_modules/,
    };
    function transpileTypeScript(file: string) {
        if (file.slice(-4) === '.tsx') {
            return true;
        }
        if (file.slice(-3) === '.ts') {
            return true;
        }
        const result = [
            'pupa',
            'njct',
            'react-eventmanager',
            ['1-liners', 'module'].join(path.sep),
        ].find((name: string) => file.indexOf(`node_modules${path.sep}${name}`) !== -1);
        return Boolean(result);
    }
    const postPlugins = [
        require('autoprefixer')({ browsers: 'last 3 versions' }),
    ];
    let config: Configuration = {
        mode: options.mode,
        context,
        entry: {
            app: './src/main.ts',
            libs: (() => {
                return [
                    ...Object.keys(pkg.dependencies),
                    'tslib/tslib.es6.js',
                    'webpack-dev-server/client',
                    'webpack/hot/emitter',
                    'webpack/hot/log-apply-result',
                    // 'webpack/hot/dev-server', // DONT! It will break HMR
                ];
            })(),
            style: './src/style.scss',
        },
        output: {
            path: buildPath,
            publicPath: '',
            chunkFilename: (() => {
                if (options.prod) {
                    return '[name]-[hash:6].js';
                }
                return '[name].js';
            })(),
            filename: (() => {
                if (options.prod) {
                    return '[name]-[hash:6].js';
                }
                return '[name].js';
            })(),
        },
        devtool: ((): Options.Devtool => {
            if (options.test) {
                return 'inline-source-map';
            }
            if (options.prod) {
                return 'source-map';
            }
            return ('webpack_devtool' in process.env) ? process.env.webpack_devtool as any : 'cheap-source-map';
        })(),
        devServer: {
            https: false,
            overlay: true,
            noInfo: false,
            contentBase: [sourcePath, buildPath],
            port: 8610,
            historyApiFallback: true,
            hot: true,
            inline: true,
            disableHostCheck: true,
            stats,
            watchOptions,
        },
        stats,
        node: {
            // workaround for webpack-dev-server issue
            // https://github.com/webpack/webpack-dev-server/issues/60#issuecomment-103411179
            fs: 'empty',
            net: 'empty',
            buffer: 'empty',
            Buffer: false,
            setimmediate: false,
        },
        target: 'web',
        resolve: {
            extensions: ['.tsx', '.ts', '.js'],
            modules: ['node_modules'],
        },
        watchOptions,
        module: {
            rules: [
                { parser: { amd: false } },
                {
                    test: /\.(js|css)$/,
                    exclude: sourcePath,
                    enforce: 'pre',
                    use: loader('source-map'),
                },
                {
                    test: transpileTypeScript,
                    use: (() => {
                        const tsOptions = { transpileOnly: true, compilerOptions: { module: 'es2015' } };
                        if (options.dev) {
                            tsOptions.compilerOptions['target'] = 'es2017';
                        }
                        if (options.prod) {
                            tsOptions.compilerOptions['target'] = 'es5';
                        }
                        const result: any[] = [
                            loader('ts', tsOptions),
                        ];
                        return result;
                    })(),
                },
                {
                    test: /index\.html$/,
                    use: [loader('html', { minimize: false })],
                },
                {
                    test: /\.css$/,
                    use: [loader('css', { sourceMap: true, minimize: options.minimize })],
                },
                {
                    test: /\.scss$/,
                    use: (() => {
                        let use: any[] = [
                            loader('css', { importLoaders: 2, sourceMap: options.sourceMap, minimize: options.minimize }),
                            loader('postcss', { plugins: postPlugins, sourceMap: options.sourceMap }),
                            loader('sass', { sourceMap: options.sourceMap, includePaths: ['node_modules/papercss/src'] }),
                        ];
                        if (options.prod && !options.style) {
                            use = ExtractTextPlugin.extract({ use });
                        }
                        if (!options.style) {
                            use.unshift(loader('style', { sourceMap: false }));
                        }
                        return use;
                    })(),
                },
                {
                    test: function fileLoaderTest(file: string) {
                        return /\.(woff|woff2|eot|ttf|png|svg)$/.test(file);
                    },
                    use: [loader('file', { name: `i/[name]${options.prod ? '-[hash:6]' : ''}.[ext]` })],
                },
            ],
        },
        optimization: {
            minimize: options.minimize,
            minimizer: (() => {
                const result: any[] = [];
                if (options.minimize) {
                    const UglifyJsPlugin = require('uglifyjs-webpack-plugin');
                    const uglifyOptions = { output: { comments: false } };
                    result.push(new UglifyJsPlugin({ sourceMap: true, uglifyOptions }));
                }
                return result;
            })(),
        },
        plugins: (() => {
            const result: any[] = [];
            if (options.hmr) {
                result.push(new webpack.NamedModulesPlugin());
            }
            if (!options.test) {
                const HtmlWebpackPlugin = require('html-webpack-plugin');
                const ScriptExtHtmlWebpackPlugin = require('script-ext-html-webpack-plugin');
                result.push(new HtmlWebpackPlugin({
                    template: './src/index.html',
                    inject: 'head',
                    minify: false,
                    excludeChunks: [],
                    config: options,
                }));
                result.push(new ScriptExtHtmlWebpackPlugin({
                    defaultAttribute: 'defer'
                }));
            }
            if (options.prod) {
                const ModuleConcatenationPlugin = require('webpack/lib/optimize/ModuleConcatenationPlugin');
                const CopyWebpackPlugin = require('copy-webpack-plugin');
                result.push(new CopyWebpackPlugin([
                    { from: 'src/manifest.json', to: undefined },
                    { from: 'resources/*.{png,ico,html}', context: 'src', to: undefined },
                ]));
                const LoaderOptionsPlugin = require('webpack/lib/LoaderOptionsPlugin');
                result.push(
                    new webpack.DefinePlugin({
                        'process.env.NODE_ENV': JSON.stringify('production'),
                    }),
                    new ModuleConcatenationPlugin(),
                    new LoaderOptionsPlugin({
                        minimize: options.minimize,
                        debug: false,
                        options: { context }
                    }),
                );
                result.push(new ExtractTextPlugin({ filename: (get) => get(`[name]${options.prod ? '-[hash:6]' : ''}.css`) }));
            }
            // TODO: Move to prod?
            const OfflinePlugin = require('offline-plugin');
            result.push(new OfflinePlugin({
                ServiceWorker: {
                    entry: './src/service-worker.ts',
                    output: 'service-worker.js'
                }
            }));

            const envName = ('env_name' in process.env) ? process.env.env_name : undefined;
            const environmentFile = `src/environment.${envName}.ts`;
            if (options.dev && !options.test && envName && fs.existsSync(environmentFile)) {
                process.stdout.write(`environment: ${envName} `);
                result.push(new webpack.NormalModuleReplacementPlugin(/src[/\\]environment\.ts$/, result => result.resource = Path.resolve(environmentFile)));
            }
            const CircularDependencyPlugin = require('circular-dependency-plugin');
            result.push(new CircularDependencyPlugin({ exclude: /node_modules/, failOnError: true }));
            return result;
        })(),
    };

    // Make config for libs build.
    if (options.libs) {
        config = {
            ...config,
            ... {
                entry: pick(['libs'], config.entry), // check name near DllReferencePlugin
                devtool: 'source-map',
                output: {
                    path: buildPath,
                    filename: '[name].js',
                    library: '[name]',
                },
                plugins: [
                    new webpack.DllPlugin({
                        name: '[name]',
                        path: `${buildPath}/[name].json`
                    }),
                ]
            }
        };
        // For libs, pick only necessary rules.
        config.module.rules = config.module.rules
            .filter(rule => {
                if (rule.test && rule.test === transpileTypeScript) {
                    return true;
                } else if ('parser' in rule) {
                    return true;
                }
                return false;
            });
    } else if (options.style) {
        // Make config for style build.
        config = {
            ...config,
            ...{
                entry: pick(['style'], config.entry),
                plugins: (() => {
                    const RemoveAssetsPlugin = require('webpack-remove-assets-plugin');
                    return [
                        new ExtractTextPlugin({ filename: (get) => get(`[name]${options.prod ? '-[hash:6]' : ''}.css`) }),
                        new RemoveAssetsPlugin({regex: /dummy/}),
                    ];
                })(),
            }
        };
        const styleAssetsRule = config.module.rules.find((r: any) => r.test && r.test.name === 'fileLoaderTest');
        const { use: styleLoaders } = config.module.rules.find(r => String(r.test) === '/\\.scss$/');
        config.module.rules = [
            styleAssetsRule,
            { test: /\.scss$/, use: ExtractTextPlugin.extract({ use: styleLoaders }) },
        ];
        config.output.filename = `dummy.js`;
    } else {
        // Make config for app build.
        config.entry = pick(['app'], config.entry);
        if (options.test) {
            config.entry = false as any;
        }
        if (options.dev && !options.coverage) {
            const libs = `${buildPath}/libs.json`; // check name in src/index.html
            if (!fs.existsSync(libs)) {
                console.log(`\nCannot link '${libs}', executing npm run build:libs`);
                execa.sync('npm', ['run', 'build:libs'], { stdio: 'inherit' });
            }
            config.plugins.push(new webpack.DllReferencePlugin({ context, manifest: require(libs) }));
        }
        if (!options.test) {
            const AddAssetHtmlPlugin = require('add-asset-html-webpack-plugin');
            const glob = require('glob');
            const stylePattern = `style${options.dev ? '' : '-*'}`;
            let [style] = glob.sync(`${buildPath}/${stylePattern}.css`);
            if (!style) {
                console.log('\nStyle was not found, executing npm run build:style');
                execa.sync('npm', ['run', `build:style${options.prod ? ':prod' : ''}`], { stdio: 'inherit' });
                [style] = glob.sync(`${buildPath}/${stylePattern}.css`);
            }
            config.plugins.push(new AddAssetHtmlPlugin({ filepath: style, typeOfAsset: 'css', includeSourcemap: options.sourceMap }));
            if (options.dev) {
                config.plugins.push(new AddAssetHtmlPlugin({ filepath: `${buildPath}/libs.js`, typeOfAsset: 'js' }));
            }
        }
    }

    return config;
};

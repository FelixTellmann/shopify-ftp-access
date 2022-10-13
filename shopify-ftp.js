"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var commander = require("commander");
var path = require("path");
var shopify_typed_node_api_1 = require("shopify-typed-node-api");
var chalk = require("chalk");
var request = require("request");
var ftpd = require("./lib/ftpd");
(function () {
    "use strict";
    commander
        .version(require("./package.json").version)
        .option("-p, --port [port]", "listen on specified port")
        .option("-b, --bind [address]", "bind to specified address")
        .parse(process.argv);
    var PATH_SEP = path.sep;
    var _slice = Array.prototype.slice;
    var config = {
        port: commander.port || 2121,
        bind: commander.bind || "127.0.0.1"
    };
    var ftp = createServer(config);
    ftp.listen(config.port, config.bind, function () {
        console.log("FTP server listening on ".concat(config.bind, ":").concat(config.port));
    });
    function createServer(config) {
        var ftp = new ftpd.FtpServer(config.bind, {
            pasvPortRangeStart: config.pasvPortRangeStart || 4000,
            pasvPortRangeEnd: config.pasvPortRangeEnd || 5000,
            getInitialCwd: function (connection, callback) {
                connection.emit("get-initial-cwd", callback);
            },
            getRoot: function (connection) {
                return "/";
            },
            useReadFile: true,
            useWriteFile: true
        });
        ftp.on("client:connected", clientConnected.bind(null, config));
        return ftp;
    }
    function clientConnected(config, ftpCon) {
        config = Object.create(config);
        console.log("FTP connection from ".concat(ftpCon.socket.remoteAddress));
        ftpCon.on("command:user", function (username, success, failure) {
            var _a;
            var parsed = parseUser(username);
            config.username = username;
            config.api_key = parsed.api_key;
            config.name = parsed.name;
            config.shop = (_a = parsed.shop) !== null && _a !== void 0 ? _a : "".concat(parsed.name, ".myshopify.com");
            config.themekit = parsed.themekit;
            success();
        });
        ftpCon.on("command:pass", function (password, success, failure) {
            config.password = password;
            config.API = new shopify_typed_node_api_1["default"].Clients.Rest(config.shop, password);
            var proxy = new Proxy(config);
            proxy.getThemes(function (error, themes) {
                if (error)
                    return failure(error);
                proxy.initThemes = themes;
                success(config.username, proxy);
            });
        });
        ftpCon.on("close", function () {
            console.log("Connection closed");
        });
        ftpCon.on("get-initial-cwd", function (callback) {
            callback(null, "/");
        });
    }
    function Proxy(config) {
        this["config"] = config;
        this.itemCache = {
            "/": { role: "directory" }
        };
    }
    Proxy.prototype = {
        readdir: function (path, callback) {
            var _this = this;
            var initThemes = this.initThemes;
            delete this.initThemes;
            if (path === "/") {
                if (initThemes) {
                    callback(null, getNames(initThemes));
                }
                else {
                    this.getThemes(function (error, themes) {
                        if (error)
                            return callback(error);
                        callback(null, getNames(themes));
                    });
                }
            }
            else {
                this.getTheme(path, function (error, theme) {
                    if (error)
                        return callback(error);
                    _this.getAssets(theme, function (error) {
                        if (error)
                            return callback(error);
                        var names = {};
                        var prefix = "".concat(path, "/");
                        Object.keys(_this.itemCache).forEach(function (itemPath) {
                            if (itemPath.indexOf(prefix) === 0) {
                                var name_1 = itemPath.slice(prefix.length).split("/")[0];
                                names[name_1] = 1;
                            }
                        });
                        callback(null, Object.keys(names));
                    });
                });
            }
        },
        getTheme: function (path, callback) {
            return __awaiter(this, void 0, void 0, function () {
                var themeName, theme;
                var _this = this;
                return __generator(this, function (_a) {
                    themeName = path.slice(1).split("/")[0];
                    theme = this.itemCache["/".concat(themeName)];
                    if (theme)
                        return [2, callback(null, theme)];
                    this.getThemes(function (error) {
                        if (error)
                            return callback(error);
                        var theme = _this.itemCache["/".concat(themeName)];
                        if (!theme) {
                            error = new Error("Not found: /".concat(themeName));
                            console.error(error.stack);
                            return callback(error);
                        }
                        callback(null, theme);
                    });
                    return [2];
                });
            });
        },
        getThemes: function (callback) {
            return __awaiter(this, void 0, void 0, function () {
                var body;
                var _this = this;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4, this.config.API.get({
                                path: "themes",
                                tries: 20
                            })];
                        case 1:
                            body = (_a.sent()).body;
                            body.themes.forEach(function (theme) {
                                _this.itemCache["/".concat(theme.name.replace(/\//g, "-"))] = theme;
                            });
                            console.log(this.itemCache);
                            callback(null, body.themes);
                            return [2];
                    }
                });
            });
        },
        getAssets: function (theme, callback) {
            return __awaiter(this, void 0, void 0, function () {
                var body, directories_1, err_1;
                var _this = this;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 3]);
                            return [4, this.config.API.get({
                                    path: "themes/".concat(theme.id, "/assets"),
                                    tries: 20
                                })];
                        case 1:
                            body = (_a.sent()).body;
                            directories_1 = {};
                            body.assets.forEach(function (asset) {
                                if (!_this.itemCache["/".concat(theme.name, "/").concat(asset.key)] ||
                                    _this.itemCache["/".concat(theme.name, "/").concat(asset.key)].updated_at !== asset.updated_at) {
                                    _this.itemCache["/".concat(theme.name, "/").concat(asset.key)] = asset;
                                }
                                var parts = asset.key.split("/");
                                var name = parts.pop();
                                parts.forEach(function (name, i) {
                                    var dirName = parts.slice(0, i + 1).join("/");
                                    if (!directories_1[dirName]) {
                                        directories_1[dirName] = [];
                                    }
                                });
                                var dirName = parts.join("/");
                                directories_1[dirName].push(__assign(__assign({}, asset), { name: name }));
                            });
                            Object.keys(directories_1).forEach(function (dirName) {
                                if (!_this.itemCache["/".concat(theme.name, "/").concat(dirName)] ||
                                    _this.itemCache["/".concat(theme.name, "/").concat(dirName)].updated_at !== theme.updated_at) {
                                    _this.itemCache["/".concat(theme.name, "/").concat(dirName)] = {
                                        name: dirName,
                                        role: "directory",
                                        created_at: theme.created_at,
                                        updated_at: theme.updated_at
                                    };
                                }
                            });
                            callback(null, directories_1);
                            return [3, 3];
                        case 2:
                            err_1 = _a.sent();
                            console.log(err_1.message);
                            callback(err_1.message);
                            return [3, 3];
                        case 3: return [2];
                    }
                });
            });
        },
        stat: function (path, callback) {
            var _this = this;
            this.getTheme(path, function (error, theme) {
                if (error)
                    return callback(error);
                var item = _this.itemCache[path];
                if (!item) {
                    _this.getAssets(theme, function (error) {
                        if (error)
                            return callback(error);
                        if (!_this.itemCache[path]) {
                            error = new Error("Not found: ".concat(path));
                            console.error(error.stack);
                            return callback(error);
                        }
                        _this.stat(path, callback);
                    });
                    return;
                }
                var type = item.role ? "directory" : "file";
                callback(null, new StatsObject(type, item));
            });
        },
        mkdir: function (path, mode, callback) {
            var error = new Error("EACCES, permission denied");
            error.code = "EACCES";
            return callback(error);
        },
        rmdir: function (path, callback) {
            var error = new Error("EACCES, permission denied");
            error.code = "EACCES";
            return callback(error);
        },
        rename: function (src, dst, callback) {
            var _this = this;
            var srcParts = src.slice(1).split("/");
            var dstParts = dst.slice(1).split("/");
            if (srcParts.length < 3 || dstParts.length < 3) {
                var error = new Error("EACCES, permission denied");
                error.code = "EACCES";
                return callback(error);
            }
            this.getTheme(src, function (error, theme) { return __awaiter(_this, void 0, void 0, function () {
                var srcPath, dstPath, err_2;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (error)
                                return [2, callback(error)];
                            srcPath = src.slice(1).split("/").slice(1).join("/");
                            dstPath = dst.slice(1).split("/").slice(1).join("/");
                            _a.label = 1;
                        case 1:
                            _a.trys.push([1, 4, , 5]);
                            return [4, this.config.API.put({
                                    type: shopify_typed_node_api_1.DataType.JSON,
                                    path: "themes/".concat(theme.id, "/assets"),
                                    data: {
                                        asset: {
                                            key: dstPath,
                                            source_key: srcPath
                                        }
                                    },
                                    tries: 20
                                })];
                        case 2:
                            _a.sent();
                            return [4, this.config.API["delete"]({
                                    type: shopify_typed_node_api_1.DataType.JSON,
                                    path: "themes/".concat(theme.id, "/assets"),
                                    query: {
                                        "asset[key]": srcPath
                                    },
                                    tries: 20
                                })];
                        case 3:
                            _a.sent();
                            console.log(chalk.green("Renamed ".concat(src.split("/").at(-1), " to ").concat(dst.split("/").at(-1), ".")));
                            callback();
                            return [3, 5];
                        case 4:
                            err_2 = _a.sent();
                            console.log(chalk.red("Renaming ".concat(src.split("/").at(-1), " to ").concat(dst.split("/").at(-1), " failed.")));
                            console.log(err_2.message);
                            err_2.code = "EACCES";
                            callback(err_2);
                            return [3, 5];
                        case 5: return [2];
                    }
                });
            }); });
        },
        unlink: function (path, callback) {
            var _this = this;
            this.getTheme(path, function (error, theme) { return __awaiter(_this, void 0, void 0, function () {
                var err_3;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (error)
                                return [2, callback(error)];
                            _a.label = 1;
                        case 1:
                            _a.trys.push([1, 3, , 4]);
                            return [4, this.config.API["delete"]({
                                    type: shopify_typed_node_api_1.DataType.JSON,
                                    path: "themes/".concat(theme.id, "/assets"),
                                    query: {
                                        "asset[key]": path.slice(1).split("/").slice(1).join("/")
                                    },
                                    tries: 20
                                })];
                        case 2:
                            _a.sent();
                            console.log(chalk.green("Deleted: ".concat(path.split("/").at(-1))));
                            callback();
                            return [3, 4];
                        case 3:
                            err_3 = _a.sent();
                            console.log(chalk.red("Could not delete ".concat(path.split("/").at(-1))));
                            console.log(err_3.message);
                            err_3.code = "EACCES";
                            callback(err_3);
                            return [3, 4];
                        case 4: return [2];
                    }
                });
            }); });
        },
        createReadStream: function (path, opts) {
            console.log("createReadStream", path, opts);
            throw new Error("Not implemented");
        },
        createWriteStream: function (path, opts) {
            console.log("createReadStream", path, opts);
            throw new Error("Not implemented");
        },
        readFile: function (path, callback) {
            var _this = this;
            var item = this.itemCache[path];
            this.getTheme(path, function (error, theme) { return __awaiter(_this, void 0, void 0, function () {
                var body, err_4;
                var _this = this;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (error)
                                return [2, callback(error)];
                            if (!item) {
                                this.getAssets(theme, function (error) {
                                    if (error)
                                        return callback(error);
                                    if (!_this.itemCache[path]) {
                                        error = new Error("Not found: ".concat(path));
                                        console.log(error.stack);
                                        return callback(error);
                                    }
                                    _this.readFile(path, callback);
                                });
                                return [2];
                            }
                            if (!item.public_url) return [3, 1];
                            request({ url: item.public_url, encoding: null }, function (error, response, body) {
                                if (error)
                                    return callback(error);
                                callback(null, body);
                            });
                            return [3, 4];
                        case 1:
                            _a.trys.push([1, 3, , 4]);
                            this.itemCache[path] = __assign(__assign({}, item), { downloaded_at: Date.now() });
                            return [4, this.config.API.get({
                                    path: "themes/".concat(theme.id, "/assets"),
                                    query: {
                                        "asset[key]": path.slice(1).split("/").slice(1).join("/")
                                    },
                                    tries: 20
                                })];
                        case 2:
                            body = (_a.sent()).body;
                            this.itemCache[path] = __assign(__assign({}, item), { downloaded_at: Date.now() });
                            console.log(chalk.green("Read File: ".concat(path.split("/").at(-1))));
                            callback(null, body.asset.value
                                ? Buffer.from(body.asset.value)
                                : Buffer.from(body.asset.attachment, "base64"));
                            return [3, 4];
                        case 3:
                            err_4 = _a.sent();
                            console.log(chalk.red("Could not read ".concat(path.split("/").at(-1))));
                            console.log(err_4.message);
                            err_4.code = "EACCES";
                            callback(err_4);
                            return [3, 4];
                        case 4: return [2];
                    }
                });
            }); });
        },
        writeFile: function (path, data, callback) {
            var _this = this;
            var _a;
            if (((_a = this.itemCache[path]) === null || _a === void 0 ? void 0 : _a.downloaded_at) > Date.now() - 1000 * 20) {
                console.log(chalk.yellowBright("Downloaded less than 20s ago: ".concat(path.split("/").at(-1))));
                callback();
                return;
            }
            this.getTheme(path, function (error, theme) { return __awaiter(_this, void 0, void 0, function () {
                var body, err_5;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (error)
                                return [2, callback(error)];
                            _a.label = 1;
                        case 1:
                            _a.trys.push([1, 3, , 4]);
                            return [4, this.config.API.put({
                                    path: "themes/".concat(theme.id, "/assets"),
                                    type: shopify_typed_node_api_1.DataType.JSON,
                                    data: {
                                        asset: {
                                            key: path.slice(1).split("/").slice(1).join("/"),
                                            attachment: data.toString("base64")
                                        }
                                    },
                                    tries: 20
                                })];
                        case 2:
                            body = (_a.sent()).body;
                            console.log(chalk.green("Updated File: ".concat(path.split("/").at(-1))));
                            callback();
                            return [3, 4];
                        case 3:
                            err_5 = _a.sent();
                            console.log(chalk.red("Could not update ".concat(path.split("/").at(-1))));
                            console.log(err_5.message);
                            err_5.code = "EACCES";
                            callback(err_5);
                            return [3, 4];
                        case 4: return [2];
                    }
                });
            }); });
        }
    };
    if (PATH_SEP !== "/") {
        [
            "readdir",
            "stat",
            "mkdir",
            "rmdir",
            "rename",
            "unlink",
            "createReadStream",
            "createWriteStream",
            "readFile",
            "writeFile",
        ].forEach(function (methodName) {
            var oldMethod = Proxy.prototype[methodName];
            var numToFix = methodName === "rename" ? 2 : 1;
            Proxy.prototype[methodName] = function () {
                var args = _slice.call(arguments);
                for (var i = 0; i < numToFix; i++) {
                    args[i] = args[i].split(PATH_SEP).join("/");
                }
                return oldMethod.apply(this, args);
            };
        });
    }
    function StatsObject(type, item) {
        this.name = item.name || "";
        this.type = type;
        this.size = item.size || 0;
        this.mtime =
            typeof item.updated_at === "string" ? new Date(Date.parse(item.updated_at)) : item.updated_at;
        this.ctime =
            typeof item.created_at === "string" ? new Date(Date.parse(item.created_at)) : item.created_at;
        this.atime = this.mtime;
    }
    StatsObject.prototype = {
        isFile: function () {
            return this.type === "file";
        },
        isDirectory: function () {
            return this.type === "directory";
        },
        isBlockDevice: function () {
            return false;
        },
        isCharacterDevice: function () {
            return false;
        },
        isSymbolicLink: function () {
            return false;
        },
        isFIFO: function () {
            return false;
        },
        isSocket: function () {
            return false;
        }
    };
    function parseUser(string) {
        var parts = string.split(/[@#]/);
        var themekit = /theme-kit-access$/gi.test(string)
            ? "theme-kit-access.shopifyapps.com/cli"
            : null;
        var shop = themekit ? string.split(/[@]/)[0] : null;
        if (shop && !/\.myshopify\.com/.test(shop)) {
            shop += ".myshopify.com";
        }
        return {
            api_key: parts[0],
            name: parts[1],
            themekit: themekit,
            shop: shop
        };
    }
    function getNames(list) {
        return list.map(function (item) {
            return item.name;
        });
    }
})();

import * as commander from "commander";
import * as path from "path";
import { Asset, Theme } from "shopify-typed-node-api/dist/clients/rest/dataTypes";
import Shopify, { DataType } from "shopify-typed-node-api";
import { RestClient } from "shopify-typed-node-api/dist/clients/rest";
import * as chalk from "chalk";

const request = require("request");
const ftpd = require("./lib/ftpd");

(function () {
  "use strict";

  commander
    .version(require("./package.json").version)
    .option("-p, --port [port]", "listen on specified port")
    .option("-b, --bind [address]", "bind to specified address")
    .parse(process.argv);

  const PATH_SEP = path.sep;
  const _slice = Array.prototype.slice;

  const config = {
    port: commander.port || 2121,
    bind: commander.bind || "127.0.0.1",
  };
  const ftp = createServer(config);
  ftp.listen(config.port, config.bind, () => {
    console.log(`FTP server listening on ${config.bind}:${config.port}`);
  });

  function createServer(config) {
    const ftp = new ftpd.FtpServer(config.bind, {
      pasvPortRangeStart: config.pasvPortRangeStart || 4000,
      pasvPortRangeEnd: config.pasvPortRangeEnd || 5000,
      getInitialCwd: function (connection, callback) {
        connection.emit("get-initial-cwd", callback);
      },
      getRoot: function (connection) {
        return "/";
      },
      useReadFile: true,
      useWriteFile: true,
    });
    //todo: this is kinda hacky
    ftp.on("client:connected", clientConnected.bind(null, config));
    return ftp;
  }

  function clientConnected(config, ftpCon) {
    config = Object.create(config);
    console.log(`FTP connection from ${ftpCon.socket.remoteAddress}`);
    ftpCon.on("command:user", (username, success, failure) => {
      const parsed = parseUser(username);
      config.username = username;
      config.api_key = parsed.api_key;
      config.name = parsed.name;
      config.shop = parsed.shop ?? `${parsed.name}.myshopify.com`;
      config.themekit = parsed.themekit;

      success();
    });

    ftpCon.on("command:pass", (password, success, failure) => {
      config.password = password;
      config.API = new Shopify.Clients.Rest(config.shop, password);
      const proxy = new Proxy(config);
      proxy.getThemes((error, themes) => {
        if (error) return failure(error);
        proxy.initThemes = themes;
        success(config.username, proxy);
      });
    });

    ftpCon.on("close", () => {
      console.log("Connection closed");
    });

    ftpCon.on("get-initial-cwd", (callback) => {
      callback(null, "/");
    });
  }

  function Proxy(config) {
    this["config"] = config;
    this.itemCache = {
      "/": { role: "directory" },
    };
  }

  Proxy.prototype = {
    readdir: function (path, callback) {
      // special case: when we authenticated we received a initial list of
      // themes. we don't want to re-fetch right away, so we cache this list
      // for the *first* readdir
      const initThemes = this.initThemes;
      delete this.initThemes;
      if (path === "/") {
        if (initThemes) {
          callback(null, getNames(initThemes));
        } else {
          this.getThemes((error, themes) => {
            if (error) return callback(error);
            callback(null, getNames(themes));
          });
        }
      } else {
        this.getTheme(path, (error, theme) => {
          if (error) return callback(error);
          this.getAssets(theme, (error) => {
            if (error) return callback(error);
            const names = {};
            const prefix = `${path}/`;
            Object.keys(this.itemCache).forEach((itemPath) => {
              if (itemPath.indexOf(prefix) === 0) {
                const name = itemPath.slice(prefix.length).split("/")[0];
                names[name] = 1;
              }
            });
            callback(null, Object.keys(names));
          });
        });
      }
    },

    //get theme from cache for specified file path
    getTheme: async function (path, callback) {
      const themeName = path.slice(1).split("/")[0];
      const theme = this.itemCache[`/${themeName}`];
      if (theme) return callback(null, theme);

      this.getThemes((error) => {
        if (error) return callback(error);
        const theme = this.itemCache[`/${themeName}`];
        if (!theme) {
          error = new Error(`Not found: /${themeName}`);
          console.error(error.stack);
          return callback(error);
        }
        callback(null, theme);
      });
    },

    getThemes: async function (callback) {
      const { body } = await (this.config.API as RestClient).get<Theme.Get>({
        path: "themes",
        tries: 20,
      });

      body.themes.forEach((theme) => {
        if (/\//gi.test(theme.name)) {
          return;
        }
        this.itemCache[`/${theme.name.replace(/\//g, "-")}`] = theme;
      });
      callback(null, body.themes);
    },

    getAssets: async function (theme, callback) {
      try {
        const { body } = await (this.config.API as RestClient).get<Asset.Get>({
          path: `themes/${theme.id}/assets`,
          tries: 20,
        });

        const directories = {};

        body.assets.forEach((asset) => {
          if (
            !this.itemCache[`/${theme.name}/${asset.key}`] ||
            this.itemCache[`/${theme.name}/${asset.key}`].updated_at !== asset.updated_at
          ) {
            this.itemCache[`/${theme.name}/${asset.key}`] = asset;
          }
          const parts = asset.key.split("/");
          const name = parts.pop();
          //for directory path a/b/c add a, a/b, a/b/c to list of directories
          parts.forEach((name, i) => {
            const dirName = parts.slice(0, i + 1).join("/");
            if (!directories[dirName]) {
              directories[dirName] = [];
            }
          });
          const dirName = parts.join("/");
          directories[dirName].push({ ...asset, name });
        });

        Object.keys(directories).forEach((dirName) => {
          if (
            !this.itemCache[`/${theme.name}/${dirName}`] ||
            this.itemCache[`/${theme.name}/${dirName}`].updated_at !== theme.updated_at
          ) {
            this.itemCache[`/${theme.name}/${dirName}`] = {
              name: dirName,
              role: "directory",
              created_at: theme.created_at,
              updated_at: theme.updated_at,
            };
          }
        });

        callback(null, directories);
      } catch (err) {
        console.log(err.message);
        callback(err.message);
      }
    },

    stat: function (path, callback) {
      this.getTheme(path, (error, theme) => {
        if (error) return callback(error);
        const item = this.itemCache[path];
        if (!item) {
          //todo: why do we have to fetch here?
          this.getAssets(theme, (error) => {
            if (error) return callback(error);
            if (!this.itemCache[path]) {
              error = new Error(`Not found: ${path}`);
              console.error(error.stack);
              return callback(error);
            }
            this.stat(path, callback);
          });
          return;
        }
        const type = item.role ? "directory" : "file";
        callback(null, new StatsObject(type, item));
      });
    },

    mkdir: function (path, mode, callback) {
      // cannot create directories
      const error = new Error("EACCES, permission denied");
      // @ts-ignore
      error.code = "EACCES";
      return callback(error);
    },

    rmdir: function (path, callback) {
      // cannot remove directories
      const error = new Error("EACCES, permission denied");
      // @ts-ignore
      error.code = "EACCES";
      return callback(error);
    },

    // limitation: cannot move/copy between themes
    rename: function (src, dst, callback) {
      // should be of format /theme/folder/file.name
      const srcParts = src.slice(1).split("/");
      const dstParts = dst.slice(1).split("/");
      if (srcParts.length < 3 || dstParts.length < 3) {
        const error = new Error("EACCES, permission denied");
        // @ts-ignore
        error.code = "EACCES";
        return callback(error);
      }
      this.getTheme(src, async (error, theme) => {
        if (error) return callback(error);
        //todo: ensure the asset is not a directory

        const srcPath: string = src.slice(1).split("/").slice(1).join("/");
        const dstPath: string = dst.slice(1).split("/").slice(1).join("/");

        try {
          await (this.config.API as RestClient).put<Asset.Update>({
            type: DataType.JSON,
            path: `themes/${theme.id}/assets`,
            data: {
              asset: {
                key: dstPath,
                // @ts-ignore
                source_key: srcPath,
              },
            },
            tries: 20,
          });

          await (this.config.API as RestClient).delete<Asset.Delete>({
            type: DataType.JSON,
            path: `themes/${theme.id}/assets`,
            query: {
              "asset[key]": srcPath,
            },
            tries: 20,
          });
          console.log(chalk.green(`Renamed ${src.split("/").at(-1)} to ${dst.split("/").at(-1)}.`));
          callback();
        } catch (err) {
          console.log(
            chalk.red(`Renaming ${src.split("/").at(-1)} to ${dst.split("/").at(-1)} failed.`)
          );
          console.log(err.message);
          err.code = "EACCES";
          callback(err);
        }
      });
    },

    // limitation: not all files can be deleted
    unlink: function (path, callback) {
      this.getTheme(path, async (error, theme) => {
        if (error) return callback(error);
        try {
          await (this.config.API as RestClient).delete<Asset.Delete>({
            type: DataType.JSON,
            path: `themes/${theme.id}/assets`,
            query: {
              "asset[key]": path.slice(1).split("/").slice(1).join("/"),
            },
            tries: 20,
          });
          console.log(chalk.green(`Deleted: ${path.split("/").at(-1)}`));
          callback();
        } catch (err) {
          console.log(chalk.red(`Could not delete ${path.split("/").at(-1)}`));
          console.log(err.message);
          err.code = "EACCES";
          callback(err);
        }
      });
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
      const item = this.itemCache[path];
      this.getTheme(path, async (error, theme) => {
        if (error) return callback(error);
        if (!item) {
          //todo: why do we have to fetch here?
          this.getAssets(theme, (error) => {
            if (error) return callback(error);
            if (!this.itemCache[path]) {
              error = new Error(`Not found: ${path}`);
              console.log(error.stack);
              return callback(error);
            }
            this.readFile(path, callback);
          });
          return;
        }
        if (item.public_url) {
          request({ url: item.public_url, encoding: null }, (error, response, body) => {
            if (error) return callback(error);
            callback(null, body);
          });
        } else {
          try {
            this.itemCache[path] = {
              ...item,
              downloaded_at: Date.now(),
            };
            const { body } = await (this.config.API as RestClient).get<Asset.GetById>({
              path: `themes/${theme.id}/assets`,
              query: {
                "asset[key]": path.slice(1).split("/").slice(1).join("/"),
              },
              tries: 20,
            });

            this.itemCache[path] = {
              ...item,
              downloaded_at: Date.now(),
            };
            console.log(chalk.green(`Read File: ${path.split("/").at(-1)}`));
            callback(
              null,
              body.asset.value
                ? Buffer.from(body.asset.value)
                : Buffer.from(body.asset.attachment, "base64")
            );
          } catch (err) {
            console.log(chalk.red(`Could not read ${path.split("/").at(-1)}`));
            console.log(err.message);
            err.code = "EACCES";
            callback(err);
          }
        }
      });
    },

    writeFile: function (path, data, callback) {
      // console.log(this.itemCache[path]);
      if (this.itemCache[path]?.downloaded_at > Date.now() - 1000 * 20) {
        console.log(chalk.yellowBright(`Downloaded less than 20s ago: ${path.split("/").at(-1)}`));
        callback();
        return;
      }

      this.getTheme(path, async (error, theme) => {
        if (error) return callback(error);

        try {
          const { body } = await (this.config.API as RestClient).put<Asset.Update>({
            path: `themes/${theme.id}/assets`,
            type: DataType.JSON,
            data: {
              asset: {
                key: path.slice(1).split("/").slice(1).join("/"),
                attachment: data.toString("base64"),
              },
            },
            tries: 20,
          });

          console.log(chalk.green(`Updated File: ${path.split("/").at(-1)}`));
          callback();
        } catch (err) {
          console.log(chalk.red(`Could not update ${path.split("/").at(-1)}`));
          console.log(err.message);
          err.code = "EACCES";
          callback(err);
        }
      });
    },
  };

  // Windows path support
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
    ].forEach((methodName) => {
      const oldMethod = Proxy.prototype[methodName];
      const numToFix = methodName === "rename" ? 2 : 1;
      Proxy.prototype[methodName] = function () {
        // eslint-disable-next-line prefer-rest-params
        const args = _slice.call(arguments);
        for (let i = 0; i < numToFix; i++) {
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
    },
  };

  // Allow us to embed our api key + name in the username
  //  example: e660fd027591bed89e9688d443e48fee@mystore or e660fd027591bed89e9688d443e48fee#mystore
  function parseUser(string) {
    const parts = string.split(/[@#]/);
    const themekit = /theme-kit-access$/gi.test(string)
      ? "theme-kit-access.shopifyapps.com/cli"
      : null;
    let shop = themekit ? string.split(/[@]/)[0] : null;
    if (shop && !/\.myshopify\.com/.test(shop)) {
      shop += ".myshopify.com";
    }
    return {
      api_key: parts[0],
      name: parts[1],
      themekit: themekit,
      shop: shop,
    };
  }

  function getNames(list) {
    return list.map((item) => {
      return item.name;
    });
  }
})();

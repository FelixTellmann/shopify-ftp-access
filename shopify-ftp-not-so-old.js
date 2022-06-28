#!/usr/bin/env node
// eslint-disable-next-line no-redeclare
/*global process, Buffer*/
const { RestClient } = require("shopify-typed-node-api/dist/clients/rest");

(function () {
  "use strict";
  const fs = require("fs");

  const commander = require("commander");
  const request = require("request");
  const ftpd = require("./lib/ftpd");
  const path = require("path");

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
    log(`FTP server listening on ${config.bind}:${config.port}`);
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
    log(`FTP connection from ${ftpCon.socket.remoteAddress}`);
    ftpCon.on("command:user", (username, success, failure) => {
      const parsed = parseUser(username);
      config.username = username;
      config.api_key = parsed.api_key;
      config.name = parsed.name;
      config.shop = parsed.shop ?? `${parsed.name}.myshopify.com`;
      config.themekit = parsed.themekit;
      config.API = undefined;

      success();
    });

    ftpCon.on("command:pass", (password, success, failure) => {
      config.password = password;
      config.API = new RestClient(config.shop, password);
      const proxy = new Proxy(config);
      proxy.getThemes((error, themes) => {
        if (error) return failure(error);
        proxy.initThemes = themes;
        success(config.username, proxy);
      });
    });

    ftpCon.on("close", () => {
      log("Connection closed");
    });

    ftpCon.on("get-initial-cwd", (callback) => {
      callback(null, "/");
    });
  }

  function Proxy(config) {
    this.config = config;
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
      setTimeout(
        () => {
          delete this.initThemes;
        },
        500
      );
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
    getTheme: function (path, callback) {
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

    getThemes: function (callback) {
      console.log(this.config.API.get({}));
      this.get("/admin/api/2021-07/themes", (error, body) => {
        if (error) return callback(error);
        console.log("fetched themes");
        const themes = body.themes;
        themes.forEach(
          function (theme) {
            theme.name = theme.name.replace(/\//g, "-");
            this.itemCache[`/${theme.name}`] = theme;
          },
          this
        );
        callback(null, themes);
      });
    },

    getAssets: function (theme, callback) {
      this.get(`/admin/api/2021-07/themes/${theme.id}/assets`, (error, body) => {
        if (error) return callback(error);
        console.log("fetched assets for:", theme.name);
        const assets = body.assets;
        const itemCache = this.itemCache;
        const directories = {};
        assets.forEach((asset) => {
          itemCache[`/${theme.name}/${asset.key}`] = asset;
          const parts = asset.key.split("/");
          asset.name = parts.pop();
          //for directory path a/b/c add a, a/b, a/b/c to list of directories
          parts.forEach((name, i) => {
            const dirName = parts.slice(0, i + 1).join("/");
            if (!directories[dirName]) {
              directories[dirName] = [];
            }
          });
          const dirName = parts.join("/");
          directories[dirName].push(asset);
        });
        Object.keys(directories).forEach((dirName) => {
          itemCache[`/${theme.name}/${dirName}`] = {
            name: dirName,
            role: "directory",
            created_at: theme.created_at,
            updated_at: theme.updated_at,
          };
        });
        callback(null, directories);
      });
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
      error.code = "EACCES";
      return callback(error);
    },

    rmdir: function (path, callback) {
      // cannot remove directories
      const error = new Error("EACCES, permission denied");
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
        error.code = "EACCES";
        return callback(error);
      }
      this.getTheme(src, (error, theme) => {
        if (error) return callback(error);
        //todo: ensure the asset is not a directory
        const srcPath = src.slice(1).split("/").slice(1).join("/");
        const dstPath = dst.slice(1).split("/").slice(1).join("/");
        const data = {
          asset: {
            key: dstPath,
            source_key: srcPath,
          },
        };
        this.put(`/admin/api/2021-07/themes/${theme.id}/assets`, data, (error, body) => {
          if (error) return callback(error);
          const qs = {
            "asset[key]": srcPath,
          };
          this.delete(`/admin/api/2021-07/themes/${theme.id}/assets`, qs, (error, body) => {
            callback(error);
          });
        });
      });
    },

    // limitation: not all files can be deleted
    unlink: function (path, callback) {
      this.getTheme(path, (error, theme) => {
        if (error) return callback(error);
        path = path.slice(1).split("/").slice(1).join("/");
        const qs = {
          "asset[key]": path,
        };
        this.delete(`/admin/api/2021-07/themes/${theme.id}/assets`, qs, (error, body) => {
          callback(error);
        });
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
      this.getTheme(path, (error, theme) => {
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
        path = path.slice(1).split("/").slice(1).join("/");
        if (item.public_url) {
          request({ url: item.public_url, encoding: null }, (error, response, body) => {
            if (error) return callback(error);
            callback(null, body);
          });
        } else {
          const qs = {
            "asset[key]": path,
          };
          this.get(`/admin/api/2021-07/themes/${theme.id}/assets`, qs, (error, body) => {
            if (error) return callback(error);
            const asset = body.asset;
            const data = asset.value
              ? Buffer.from(asset.value)
              : Buffer.from(asset.attachment, "base64");
            callback(null, data);
          });
        }
      });
    },

    writeFile: function (path, data, callback) {
      this.getTheme(path, (error, theme) => {
        if (error) return callback(error);
        path = path.slice(1).split("/").slice(1).join("/");
        const params = {
          asset: {
            key: path,
            attachment: data.toString("base64"),
          },
        };
        this.put(`/admin/api/2021-07/themes/${theme.id}/assets`, params, (error, body) => {
          callback(error);
        });
      });
    },

    get: function (resource, qs, callback) {
      const args = _slice.call(arguments);
      callback = args.pop();
      qs = typeof args[args.length - 1] === "object" ? args.pop() : null;

      if (this.config.themekit) {
        request(
          {
            method: "GET",
            url: this.url(resource, qs),
            headers: {
              "X-Shopify-Access-Token": this.config.password,
              "X-Shopify-Shop": this.config.shop,
            },
          },
          (error, response, body) => {
            if (error) return callback(error);
            if (response.statusCode !== 200) {
              return callback(new Error(`HTTP Response Status: ${response.statusCode}`));
            }
            const contentType = response.headers["content-type"].split(";")[0].toLowerCase();
            if (contentType === "application/json") {
              try {
                body = JSON.parse(body);
              } catch (e) {
                return callback(
                  new Error(
                    `Unable to parse response JSON; Content-Length: ${response.headers["content-length"]}`
                  )
                );
              }
              return callback(null, body);
            } else {
              return callback(new Error("Unexpected Content-Type"));
            }
          }
        );
      } else {
        request(this.url(resource, qs), (error, response, body) => {
          if (error) return callback(error);
          if (response.statusCode !== 200) {
            return callback(new Error(`HTTP Response Status: ${response.statusCode}`));
          }
          const contentType = response.headers["content-type"].split(";")[0].toLowerCase();
          if (contentType === "application/json") {
            try {
              body = JSON.parse(body);
            } catch (e) {
              return callback(
                new Error(
                  `Unable to parse response JSON; Content-Length: ${response.headers["content-length"]}`
                )
              );
            }
            return callback(null, body);
          } else {
            return callback(new Error("Unexpected Content-Type"));
          }
        });
      }
    },

    put: function (resource, data, callback) {
      const args = _slice.call(arguments);
      callback = args.pop();
      data = typeof args[args.length - 1] === "object" ? args.pop() : {};
      if (this.config.themekit) {
        request(
          {
            method: "PUT",
            url: this.url(resource),
            body: data,
            json: true,
            headers: {
              "X-Shopify-Access-Token": this.config.password,
              "X-Shopify-Shop": this.config.shop,
            },
          },
          (error, response, body) => {
            if (error) return callback(error);
            callback(null, body);
          }
        );
      } else {
        request(
          { method: "PUT", url: this.url(resource), body: data, json: true },
          (error, response, body) => {
            if (error) return callback(error);
            callback(null, body);
          }
        );
      }
    },

    delete: function (resource, qs, callback) {
      const args = _slice.call(arguments);
      callback = args.pop();
      qs = typeof args[args.length - 1] === "object" ? args.pop() : null;
      if (this.config.themekit) {
        request(
          {
            method: "DELETE",
            url: this.url(resource, qs),
            json: true,
            headers: {
              "X-Shopify-Access-Token": this.config.password,
              "X-Shopify-Shop": this.config.shop,
            },
          },
          (error, response, body) => {
            if (error) {
              callback(error);
            } else {
              callback(null, body);
            }
          }
        );
      } else {
        request(
          { method: "DELETE", url: this.url(resource, qs), json: true },
          (error, response, body) => {
            if (error) {
              callback(error);
            } else {
              callback(null, body);
            }
          }
        );
      }
    },

    url: function (resource, qs) {
      const config = this.config;
      let result;
      if (config.themekit) {
        result = `https://${config.themekit}${resource}.json`;
      } else {
        result = `https://${config.api_key}:${config.password}@${config.name}.myshopify.com${resource}.json`;
      }

      if (qs) {
        qs = Object.keys(qs).map((key) => {
          return `${encodeURIComponent(key)}=${encodeURIComponent(qs[key])}`;
        });
        result += `?${qs.join("&")}`;
      }
      return result;
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

  function log() {
    console.error.apply(console, arguments);
  }
})();

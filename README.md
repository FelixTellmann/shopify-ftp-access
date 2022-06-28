## Shopify FTP Proxy

This runs a local FTP server (on localhost) that will communicate with Shopify over HTTP API and allows you to upload/download/edit your theme files and assets using your favorite FTP client.

Note: this tool is built with [Node.js](https://nodejs.org) and is installed via [npm](https://www.npmjs.org) so make sure to have Node installed. I have tested this on Mac and Windows. Please [submit an issue](https://github.com/sstur/shopify-ftp/issues) if you come across any bugs.
 
### Installation:

    npm install -g shopify-ftp2

Note: You may need to run as root/super-user on Mac/Linux using `sudo npm install -g shopify-ftp` or, alternatively, install without `-g` and then specify the full path to `shopify.js` in place of `shopify` each time you launch the program. The full path might look something like `/Users/You/node_modules/shopify-ftp/shopify.js` depending on where `npm` puts your module.

### Usage:

    shopify ftp

By default, it will listen on 127.0.0.1 at port 2121. The port and host can, optionally, be specified as follows:

    shopify ftp --port 2121 --host 127.0.0.1

Beginner note: The above commands should be entered at the command line (Terminal.app on Mac or Command Prompt on Windows)

### Get Shopify API Key(s)

You will need a Shopify API key-pair.

 * Go to: [{store-name}.myshopify.com/admin/apps](https://myshopify.com/admin/apps)
 * Click "Private Apps" in the top right corner
 * Click on an existing private app or create a new one
 * Copy the API key and Password

### Connecting over FTP

Open your favorite FTP client, for instance [FileZilla](https://filezilla-project.org/) and create a new connection with the following details:

 * Host: `127.0.0.1`
 * Port: `2121`
 * Username: `{api-key}@{store-name}`
 * Password: `{api-password}`

Then save/connect and you should be able to browse your assets and templates including upload, delete, rename, download and move. When you first connect, you should see a list of folders which corresponds to your different themes. Choose your theme and go into that directory. There you will see a few directories (assets, config, layout, snippets, templates). You can add/rename/delete files from these directories, but you will not be able to create/delete sub-directories due to limitations in place by Shopify. You must use the folder structure that exists.

Note: Your username contains __both__ your API key and your store name (separated by `@`).

I'd like to get this working with [ExpanDrive](http://www.expandrive.com/) to mount as a local directory on OS X. However, currently this isn't possible because Shopify API doesn't support upload/download ranges (partial files).

[Follow me on Twitter](https://twitter.com/sstur_) for updates!

Have fun.

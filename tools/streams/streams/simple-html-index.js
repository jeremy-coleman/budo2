import { Readable } from 'stream';
const favicon = '<link rel="shortcut icon"type="image/x-icon" href="data:image/x-icon;,">';
let stylesheet = `<style>
* {
  box-sizing: border-box;
}
html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  background: white;
}
</style>`;
function createHtml(opt) {
    opt = opt || {};
    var rs = new Readable({ objectMode: true });
    var template = [
        "<!DOCTYPE html>",
        `${stylesheet}`,
        '<html lang="' + (opt.lang || "en") + '" dir="' + (opt.dir || "ltr") + '">',
        "<head>",
        opt.title ? "<title>" + opt.title + "</title>" : "",
        '<meta charset="utf-8">',
        opt.base ? '<base href="' + opt.base + '">' : "",
        opt.css ? '<link rel="stylesheet" href="' + opt.css + '">' : "",
        opt.favicon ? favicon : "",
        "</head><body>",
        "<div id='root'></div>",
        "</body>",
        opt.entry ? '<script src="' + opt.entry + '"></script>' : "",
        "</html>",
    ].join("");
    rs.push(template);
    rs.push(null);
    return rs;
}
export { createHtml };

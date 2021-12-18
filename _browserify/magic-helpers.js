import MagicString from "magic-string";
//import { parse } from "meriyah";
import { parse } from "acorn";


function addHelpers(node, magicInstance) {
    var edit = new MagicHelpers(node, magicInstance);
    node.edit = edit;
    node.getSource = edit.source.bind(edit);
    if (node.update === undefined)
        node.update = edit.update.bind(edit);
    if (node.source === undefined)
        node.source = edit.source.bind(edit);
    if (node.append === undefined)
        node.append = edit.append.bind(edit);
    if (node.prepend === undefined)
        node.prepend = edit.prepend.bind(edit);
}
class MagicHelpers {
    constructor(node, magicInstance) {
        this.node = node;
        this.magicInstance = magicInstance;
    }
    source() {
        return this.magicInstance.slice(this.node.start, this.node.end);
    }
    update(replacement) {
        this.magicInstance.overwrite(this.node.start, this.node.end, replacement);
        return this;
    }
    append(append) {
        this.magicInstance.appendLeft(this.node.end, append);
        return this;
    }
    prepend(prepend) {
        this.magicInstance.prependRight(this.node.start, prepend);
        return this;
    }
    inspect() {
        return "[Helpers]";
    }
}
function walkAst(ast, hooks) {
    const { enter, leave } = hooks;
    walk(ast, null, enter, leave);
}
function walk(ast, parent, enter, leave) {
    if (!ast || !enter)
        return;
    if (enter(ast, parent) === false)
        return;
    for (var node in ast) {
        if (node === "parent")
            continue;
        const _key = ast[node];
        if (isNode(_key)) {
            walk(_key, ast, enter, leave);
        }
        else if (Array.isArray(_key)) {
            for (const N of _key) {
                walk(N, ast, enter, leave);
            }
        }
    }
    if (leave !== undefined)
        leave(ast, parent);
}
function isNode(node) {
    return typeof node === "object" && node && typeof node.type === "string";
}
function magicTransform(source, options, cb) {
    if (!options)
        options = {};
    if (Buffer.isBuffer(source)) {
        source = source.toString("utf8");
    }
    var magicString = new MagicString(source, options);
    var ast = parse(source, options);
    walkAst((ast), {
        enter: (node, parent) => {
            node.parent = parent;
            if (node.edit === undefined) {
                addHelpers(node, magicString);
            }
        },
        leave: cb
    });
    return Object.assign(magicString, {
        walk: (cb) => {
            walkAst(ast, {
                enter: (node, parent) => {
                    node.parent = parent;
                    if (node.edit === undefined) {
                        addHelpers(node, magicString);
                    }
                },
                leave: cb
            });
        },
        inspect: magicString.toString
    });
}
export { addHelpers, walkAst, magicTransform };
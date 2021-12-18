import path from "path";
import { Transform } from "stream";
import { magicTransform } from "./magic-helpers";
import { createScope, getBinding, getScope, isMemberExpression, isRequire, visitBinding, visitScope } from "./scope-analyzer";
var kEvaluateOnDemand = Symbol("evaluate on demand");
var kAst = Symbol("ast");
var kIsSimpleExport = Symbol("is simple export");
var kExportsName = Symbol("exports variable name");
var kRequireCalls = Symbol("require calls");
var kDependencyOrder = Symbol("dependency order of execution sort value");
var kReferences = Symbol("module/exports references");
var kMagicString = Symbol("magic string");
var kSourceMap = Symbol("source map");
var kDummyVars = Symbol("dummy replacement variables");
var kShouldRename = Symbol("should rename binding");
const toIdentifier = (s) => {
    return s
        .split(".")
        .join("_")
        .split("-")
        .join("_")
        .split("_")
        .filter((v) => v !== "_")
        .join("_");
};
function parseModule(row, index, rows) {
    var moduleExportsName = toIdentifier("_$" + getModuleName(row.file || "") + "_" + row.id);
    var requireCalls = [];
    var orderOfExecution = new Map();
    var ast;
    var globalScope = {
        type: "BrowserPackFlatWrapper",
        parent: null
    };
    createScope(globalScope, ["require", "module", "exports"]);
    var source = row.source;
    function isOrderUnpredictable(node) {
        while ((node = node.parent)) {
            if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
                if (node.parent && node.parent.type === "CallExpression" && node.parent.callee === node) {
                    continue;
                }
                if (node.parent &&
                    node.parent.type === "MemberExpression" &&
                    node.parent.object === node &&
                    (node.parent.property.name === "call" || node.parent.property.name === "apply") &&
                    node.parent.parent &&
                    node.parent.parent.type === "CallExpression") {
                    continue;
                }
            }
            if (node.parent && node.parent.type === "IfStatement" && node.parent.test === node) {
                node = node.parent;
                continue;
            }
            if (node.type === "IfStatement" ||
                node.type === "WhileStatement" ||
                node.type === "ForStatement" ||
                node.type === "ForInStatement" ||
                node.type === "FunctionExpression" ||
                node.type === "FunctionDeclaration" ||
                node.type === "ArrowFunctionExpression") {
                return true;
            }
        }
        return false;
    }
    var alreadyPredictablyEvaluated = new Set();
    var magicString = magicTransform(source, {
        module: true,
        next: true,
        webcompat: true,
        loc: true,
        ranges: true,
        ecmaVersion: 9,
        inputFilename: row.sourceFile,
        sourceType: "script"
    }, function (node) {
        if (node.type === "Program")
            ast = node;
        visitScope(node);
        if (isRequire(node)) {
            var argument = node.arguments[0];
            var required = argument.type === "Literal" ? argument.value : null;
            if (required !== null && moduleExists(row.deps[required])) {
                var other = rows.byId[row.deps[required]];
                if (isOrderUnpredictable(node)) {
                    if (!alreadyPredictablyEvaluated.has(other)) {
                        other[kEvaluateOnDemand] = true;
                    }
                }
                else {
                    alreadyPredictablyEvaluated.add(other);
                }
                requireCalls.push({
                    id: row.deps[required],
                    node: node,
                    requiredModule: other
                });
            }
            else if (required !== null) {
                requireCalls.push({
                    external: true,
                    id: row.deps[required] || required,
                    node: node
                });
            }
            if (required !== null) {
                orderOfExecution.set(row.deps[required] || required, node.end);
            }
            function moduleExists(id) {
                return id != null && !!rows.byId[id];
            }
        }
    });
    magicString.walk((node) => {
        ast.parent = globalScope;
        visitBinding(node);
    });
    var requireList = getScope(globalScope).getReferences("require");
    var moduleExportsList = getScope(globalScope)
        .getReferences("module")
        .map(function (node) {
        return node.parent;
    })
        .filter(isModuleExports);
    var exportsList = getScope(globalScope).getReferences("exports");
    var moduleList = getScope(globalScope)
        .getReferences("module")
        .filter(function (node) {
        return !isModuleExports(node.parent);
    });
    var isSimpleExport = false;
    row[kAst] = ast;
    row[kIsSimpleExport] = isSimpleExport;
    row[kExportsName] = moduleExportsName;
    row.hasExports = moduleExportsList.length + exportsList.length > 0;
    row[kRequireCalls] = requireCalls;
    row[kDependencyOrder] = orderOfExecution;
    row[kReferences] = {
        "require": requireList,
        "module": moduleList,
        "exports": exportsList,
        "module.exports": moduleExportsList
    };
    row[kMagicString] = magicString;
}
function sortModules(rows) {
    var index = new Map();
    var mod;
    while ((mod = rows.pop())) {
        index.set(mod.id, mod);
    }
    function compareDependencySortOrder(a, b) {
        var ao = typeof a.dependencyOrder === "number";
        var bo = typeof b.dependencyOrder === "number";
        if (ao && bo) {
            return a.dependencyOrder < b.dependencyOrder ? -1 : 1;
        }
        if (ao && !bo)
            return -1;
        if (!ao && bo)
            return 1;
        return compareModuleSortOrder(a.module, b.module);
    }
    var modules = Array.from(index.values()).sort(compareModuleSortOrder);
    var seen = new Set();
    function visit(mod) {
        if (seen.has(mod.id))
            return;
        seen.add(mod.id);
        if (hasDeps(mod)) {
            Object.values(mod.deps)
                .map(function attachSortOrder(id) {
                var dep = index.get(id);
                if (dep) {
                    return {
                        module: dep,
                        dependencyOrder: mod[kDependencyOrder] ? mod[kDependencyOrder].get(id) : undefined
                    };
                }
            })
                .filter(Boolean)
                .sort(compareDependencySortOrder)
                .forEach(function (dep) {
                visit(dep.module);
            });
        }
        rows.push(mod);
    }
    modules.forEach(visit);
}
function hasDeps(mod) {
    return mod.deps && Object.keys(mod.deps).length > 0;
}
function compareModuleSortOrder(a, b) {
    if (a.entry && !b.entry)
        return -1;
    if (!a.entry && b.entry)
        return 1;
    var ao = typeof a.order === "number";
    var bo = typeof b.order === "number";
    if (ao && bo) {
        return a.order < b.order ? -1 : 1;
    }
    if (ao && !bo)
        return -1;
    if (!ao && bo)
        return 1;
    return a.id < b.id ? -1 : 1;
}
function identifyGlobals(row, i, rows) {
    var ast = row[kAst];
    var globalScope = ast.parent;
    var scope = getScope(ast);
    if (scope) {
        getScope(globalScope)
            .getUndeclaredNames()
            .forEach(function (name) {
            rows.usedGlobalVariables.add(name);
        });
    }
}
function markDuplicateVariableNames(row, i, rows) {
    var ast = row[kAst];
    var scope = getScope(ast);
    if (scope) {
        scope.forEach(function (binding, name) {
            binding[kShouldRename] = rows.usedGlobalVariables.has(name);
            rows.usedGlobalVariables.add(name);
        });
    }
}
function rewriteModule(row, i, rows) {
    var moduleExportsName = row[kExportsName];
    var moduleBaseName;
    var ast = row[kAst];
    var magicString = row[kMagicString];
    var moduleList = row[kReferences].module;
    var moduleExportsList = row[kReferences]["module.exports"];
    var exportsList = row[kReferences].exports;
    var requireList = row[kReferences].require;
    if (moduleList.length > 0) {
        moduleBaseName = moduleExportsName;
        moduleExportsName += ".exports";
    }
    requireList.forEach(function (node) {
        if (node.parent.type === "UnaryExpression" && node.parent.operator === "typeof") {
            node.parent.edit.update('"function"');
        }
    });
    if (!row[kEvaluateOnDemand]) {
        moduleExportsList.concat(exportsList).forEach(function (node) {
            if (row[kIsSimpleExport]) {
                node.edit.update("var " + moduleExportsName);
            }
            else {
                renameIdentifier(node, moduleExportsName);
            }
        });
        moduleList.forEach(function (node) {
            if (node.parent.type === "UnaryExpression" && node.parent.operator === "typeof") {
                node.parent.edit.update('"object"');
            }
            else if (isModuleParent(node.parent)) {
                if (row.entry) {
                    node.parent.edit.update("null");
                }
                else {
                    node.parent.edit.update("({})");
                }
            }
            else {
                renameIdentifier(node, moduleBaseName);
            }
        });
        if (getScope(ast)) {
            getScope(ast).forEach((binding, name) => {
                if (binding[kShouldRename]) {
                    renameBinding(binding, toIdentifier("__" + name + "_" + row.id));
                }
            });
        }
    }
    row[kRequireCalls].forEach((req) => {
        var node = req.node;
        var other = req.requiredModule;
        if (req.external) {
            node.edit.update("require(" + JSON.stringify(req.id) + ")");
        }
        else if (other && other[kEvaluateOnDemand]) {
            node.edit.update(other[kExportsName] + "({})");
        }
        else if (other && other[kExportsName]) {
            renameImport(row, node, other[kExportsName]);
        }
        else {
            node.edit.update(toIdentifier("_$module_" + req.id));
        }
    });
    if (row[kEvaluateOnDemand]) {
        magicString.prepend("var " + row[kExportsName] + " = " + rows.createModuleFactoryName + "(function (module, exports) {\n");
        magicString.append("\n});");
    }
    else if (moduleBaseName) {
        magicString
            .prepend("var " + moduleBaseName + " = { exports: {} };\n")
            .append("\n" + moduleBaseName + " = " + moduleExportsName);
        moduleExportsName = moduleBaseName;
    }
    else if (!row[kIsSimpleExport]) {
        magicString.prepend("var " + moduleExportsName + " = {};\n");
    }
    row[kSourceMap] = magicString.map;
    row.source = magicString.toString();
}
const generateCodeTemplate = (rows) => {
    let _intro = rows.some((mod) => mod[kEvaluateOnDemand])
        ? `(function(){
      function createModuleFactory(t) {
        var e
        return function (r) {
          return e || t((e = { exports: {}, parent: r }), e.exports), e.exports
        }
      }`
        : `(function(){`;
    let _code = "";
    rows.forEach((row, i) => {
        if (i > 0)
            _code += "\n" + row.source;
        else
            _code += row.source;
    });
    var result = `${_intro}
  ${_code}
  }());
  `;
    return result;
};
function flatten(rows) {
    rows.byId = Object.create(null);
    rows.forEach((row) => {
        rows.byId[row.id] = row;
    });
    rows.usedGlobalVariables = new Set();
    rows.createModuleFactoryName = generateName(rows, "createModuleFactory");
    rows.forEach((row, index, rows) => {
        parseModule(row, index, rows);
    });
    sortModules(rows);
    rows.forEach(identifyGlobals);
    rows.forEach(markDuplicateVariableNames);
    rows.forEach(rewriteModule);
    moveOnDemandModulesToStart(rows);
    return Buffer.from(generateCodeTemplate(rows));
}
class BPackStream extends Transform {
    constructor() {
        super({ objectMode: true });
        this.rows = [];
    }
    _transform(row, enc, cb) {
        this.rows.push(row);
        cb(null);
    }
    _flush(cb) {
        try {
            this.push(flatten(this.rows));
            this.push(null);
            cb(null);
        }
        catch (err) {
            cb(err);
        }
    }
}
const bpack = () => new BPackStream();
function moveOnDemandModulesToStart(rows) {
    for (var i = 0; i < rows.length; i++) {
        if (rows[i][kEvaluateOnDemand]) {
            var row = rows.splice(i, 1)[0];
            rows.unshift(row);
        }
    }
}
function getNodeName(node) {
    if (node.type === "FunctionExpression")
        node = node.id;
    else if (node.type === "ClassExpression")
        node = node.id;
    if (node && node.type === "Identifier") {
        return node.name;
    }
}
function isModuleExports(node) {
    return isMemberExpression(node, "module.exports");
}
function isModuleParent(node) {
    return isMemberExpression(node, "module.parent");
}
function isObjectKey(node) {
    return node.parent.type === "Property" && node.parent.key === node;
}
function isShorthandProperty(node) {
    return node.type === "Identifier" && isObjectKey(node) && node.parent.shorthand;
}
function renameIdentifier(node, name) {
    if (isShorthandProperty(node)) {
        node.edit.update(node.name + ": " + name);
    }
    else {
        node.edit.update(name);
    }
}
function renameImport(row, node, name) {
    if (node.parent.type === "VariableDeclarator" && node.parent.id.type === "Identifier") {
        var binding = getBinding(node.parent.id);
        if (binding) {
            renameBinding(binding, name);
            removeVariableDeclarator(row, node.parent);
            return;
        }
    }
    node.edit.update(name);
}
function renameBinding(binding, newName) {
    binding.each(function (node) {
        renameIdentifier(node, newName);
    });
}
function wrapComment(text) {
    return "/* " + text.replace(/\*\//g, "*\\/") + " */";
}
function removeVariableDeclarator(row, decl) {
    if (decl.parent.type === "VariableDeclaration") {
        var i = decl.parent.declarations.indexOf(decl);
        if (decl.parent.declarations.length === 1) {
            var removed = decl.parent.getSource();
            decl.parent.edit.update(wrapComment("removed: " + removed) + ";");
        }
        else if (i === decl.parent.declarations.length - 1) {
            row[kMagicString].overwrite(decl.parent.declarations[i - 1].end, decl.end, "");
        }
        else {
            row[kMagicString].overwrite(decl.start, decl.parent.declarations[i + 1].start, "");
        }
        decl.parent.declarations.splice(i, 1);
    }
    else {
        if (!row[kDummyVars])
            row[kDummyVars] = 0;
        var id = "__dummy_" + row.index + "$" + row[kDummyVars];
        row[kDummyVars]++;
        decl.edit.update(toIdentifier(id) + " = 0");
    }
}
function getModuleName(file) {
    var parts = path.parse(file);
    var name = parts.base === "index.js" ? path.basename(parts.dir) : parts.name;
    return name || "module";
}
function generateName(rows, base) {
    var dedupe = "";
    var i = 0;
    while (true) {
        var inUse = rows.some(function (row) {
            return row.source.indexOf(base + dedupe) !== -1;
        });
        if (!inUse) {
            return base + dedupe;
        }
        dedupe = "_" + i++;
    }
}
export { bpack };
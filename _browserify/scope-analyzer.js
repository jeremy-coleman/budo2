var kScope = Symbol("scope");
function isFunction(node) {
    return (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression");
}
class Scope {
    constructor(parent) {
        this.parent = parent;
        this.bindings = new Map();
        this.undeclaredBindings = new Map();
    }
    define(binding) {
        if (this.bindings.has(binding.name)) {
            var existing = this.bindings.get(binding.name);
            binding.getReferences().forEach(function (ref) {
                existing.add(ref);
            });
        }
        else {
            this.bindings.set(binding.name, binding);
        }
        return this;
    }
    has(name) {
        return this.bindings.has(name);
    }
    add(name, ref) {
        var binding = this.bindings.get(name);
        if (binding) {
            binding.add(ref);
        }
        return this;
    }
    addUndeclared(name, ref) {
        if (!this.undeclaredBindings.has(name)) {
            this.undeclaredBindings.set(name, new Binding(name));
        }
        var binding = this.undeclaredBindings.get(name);
        binding.add(ref);
        return this;
    }
    getBinding(name) {
        return this.bindings.get(name);
    }
    getReferences(name) {
        return this.has(name) ? this.bindings.get(name).getReferences() : [];
    }
    getUndeclaredNames() {
        return Array.from(this.undeclaredBindings.keys());
    }
    forEach() {
        this.bindings.forEach.apply(this.bindings, arguments);
    }
    forEachAvailable(cb) {
        var seen = new Set();
        this.bindings.forEach(function (binding, name) {
            seen.add(name);
            cb(binding, name);
        });
        this.parent &&
            this.parent.forEachAvailable(function (binding, name) {
                if (!seen.has(name)) {
                    seen.add(name);
                    cb(binding, name);
                }
            });
    }
}
class Binding {
    constructor(name, definition) {
        this.name = name;
        this.definition = definition;
        this.references = new Set();
        if (definition)
            this.add(definition);
    }
    add(node) {
        this.references.add(node);
        return this;
    }
    remove(node) {
        if (!this.references.has(node)) {
            throw new Error("Tried removing nonexistent reference");
        }
        this.references.delete(node);
        return this;
    }
    isReferenced() {
        var definition = this.definition;
        var isReferenced = false;
        this.each(function (ref) {
            if (ref !== definition)
                isReferenced = true;
        });
        return isReferenced;
    }
    getReferences() {
        var arr = [];
        this.each(function (ref) {
            arr.push(ref);
        });
        return arr;
    }
    each(cb) {
        this.references.forEach(function (ref) {
            cb(ref);
        });
        return this;
    }
}
function getAssignedIdentifiers(node, identifiers) {
    identifiers = identifiers || [];
    if (node.type === "ImportDeclaration") {
        node.specifiers.forEach(function (el) {
            getAssignedIdentifiers(el, identifiers);
        });
    }
    if (node.type === "ImportDefaultSpecifier" ||
        node.type === "ImportNamespaceSpecifier" ||
        node.type === "ImportSpecifier") {
        node = node.local;
    }
    if (node.type === "RestElement") {
        node = node.argument;
    }
    if (node.type === "ArrayPattern") {
        node.elements.forEach(function (el) {
            if (el) {
                getAssignedIdentifiers(el, identifiers);
            }
        });
    }
    if (node.type === "ObjectPattern") {
        node.properties.forEach(function (prop) {
            if (prop.type === "Property") {
                getAssignedIdentifiers(prop.value, identifiers);
            }
            else if (prop.type === "RestElement") {
                getAssignedIdentifiers(prop, identifiers);
            }
        });
    }
    if (node.type === "Identifier") {
        identifiers.push(node);
    }
    return identifiers;
}
function createScope(node, bindings) {
    if (!node[kScope]) {
        var parent = getParentScope(node);
        node[kScope] = new Scope(parent);
    }
    if (bindings) {
        for (var i = 0; i < bindings.length; i++) {
            node[kScope].define(new Binding(bindings[i]));
        }
    }
    return node[kScope];
}
function visitScope(node) {
    registerScopeBindings(node);
}
function visitBinding(node) {
    if (isVariable(node)) {
        registerReference(node);
    }
}
function deleteScope(node) {
    if (node) {
        delete node[kScope];
    }
}
function getScope(node) {
    if (node && node[kScope]) {
        return node[kScope];
    }
    return null;
}
function getBinding(identifier) {
    var scopeNode = getDeclaredScope(identifier);
    if (!scopeNode)
        return null;
    var scope = getScope(scopeNode);
    if (!scope)
        return null;
    return scope.getBinding(identifier.name) || scope.undeclaredBindings.get(identifier.name);
}
function registerScopeBindings(node) {
    if (node.type === "Program") {
        createScope(node);
    }
    if (node.type === "VariableDeclaration") {
        var scopeNode = getNearestScope(node, node.kind !== "var");
        var scope = createScope(scopeNode);
        node.declarations.forEach(function (decl) {
            getAssignedIdentifiers(decl.id).forEach(function (id) {
                scope.define(new Binding(id.name, id));
            });
        });
    }
    if (node.type === "ClassDeclaration") {
        var scopeNode = getNearestScope(node);
        var scope = createScope(scopeNode);
        if (node.id && node.id.type === "Identifier") {
            scope.define(new Binding(node.id.name, node.id));
        }
    }
    if (node.type === "FunctionDeclaration") {
        var scopeNode = getNearestScope(node, false);
        var scope = createScope(scopeNode);
        if (node.id && node.id.type === "Identifier") {
            scope.define(new Binding(node.id.name, node.id));
        }
    }
    if (isFunction(node)) {
        var scope = createScope(node);
        node.params.forEach(function (param) {
            getAssignedIdentifiers(param).forEach(function (id) {
                scope.define(new Binding(id.name, id));
            });
        });
    }
    if (node.type === "FunctionExpression" || node.type === "ClassExpression") {
        var scope = createScope(node);
        if (node.id && node.id.type === "Identifier") {
            scope.define(new Binding(node.id.name, node.id));
        }
    }
    if (node.type === "ImportDeclaration") {
        var scopeNode = getNearestScope(node, false);
        var scope = createScope(scopeNode);
        getAssignedIdentifiers(node).forEach(function (id) {
            scope.define(new Binding(id.name, id));
        });
    }
    if (node.type === "CatchClause") {
        var scope = createScope(node);
        if (node.param) {
            getAssignedIdentifiers(node.param).forEach(function (id) {
                scope.define(new Binding(id.name, id));
            });
        }
    }
}
function getParentScope(node) {
    var parent = node;
    while (parent.parent) {
        parent = parent.parent;
        if (getScope(parent))
            return getScope(parent);
    }
}
function getNearestScope(node, blockScope) {
    var parent = node;
    while (parent.parent) {
        parent = parent.parent;
        if (isFunction(parent)) {
            break;
        }
        if (blockScope && parent.type === "BlockStatement") {
            break;
        }
        if (parent.type === "Program") {
            break;
        }
    }
    return parent;
}
function getDeclaredScope(id) {
    var parent = id;
    if (id.parent.type === "FunctionDeclaration" && id.parent.id === id) {
        parent = id.parent;
    }
    while (parent.parent) {
        parent = parent.parent;
        if (parent[kScope] && parent[kScope].has(id.name)) {
            break;
        }
    }
    return parent;
}
function registerReference(node) {
    var scopeNode = getDeclaredScope(node);
    var scope = getScope(scopeNode);
    if (scope && scope.has(node.name)) {
        scope.add(node.name, node);
    }
    if (scope && !scope.has(node.name)) {
        scope.addUndeclared(node.name, node);
    }
}
function isObjectKey(node) {
    return (node.parent.type === "Property" &&
        node.parent.key === node &&
        node.parent.value !== node);
}
function isMethodDefinition(node) {
    return node.parent.type === "MethodDefinition" && node.parent.key === node;
}
function isImportName(node) {
    return node.parent.type === "ImportSpecifier" && node.parent.imported === node;
}
function isVariable(node) {
    return (node.type === "Identifier" &&
        !isObjectKey(node) &&
        !isMethodDefinition(node) &&
        (node.parent.type !== "MemberExpression" ||
            node.parent.object === node ||
            (node.parent.property === node && node.parent.computed)) &&
        !isImportName(node));
}
function isMemberExpression(node, pattern) {
    if (typeof pattern === "string") {
        pattern = pattern.split(".");
    }
    return matchesExpression(node, pattern);
}
function matchesExpression(node, pattern) {
    if (node.type !== "MemberExpression") {
        return false;
    }
    if (!pattern) {
        return true;
    }
    if (isProperty(node.property, node.computed, pattern[pattern.length - 1])) {
        if (pattern.length === 2) {
            return node.object.type === "Identifier" && node.object.name === pattern[0];
        }
        return matchesExpression(node.object, pattern.slice(0, -1));
    }
    return false;
}
function isProperty(node, computed, name) {
    if (node.type === "Identifier" && !computed) {
        return node.name === name;
    }
    if (node.type === "StringLiteral" || node.type === "Literal") {
        return node.value === name;
    }
    return false;
}
function isIdentifier(node, name) {
    if (node.type !== "Identifier") {
        return false;
    }
    if (!name) {
        return true;
    }
    return node.name === name;
}
function isRequire(node, source) {
    if (node.type !== "CallExpression" || !isIdentifier(node.callee, "require")) {
        return false;
    }
    var arg = node.arguments[0];
    if (!arg) {
        return false;
    }
    if (arg.type !== "Literal" &&
        arg.type !== "StringLiteral" &&
        arg.type !== "NumericLiteral" &&
        arg.type !== "TemplateLiteral") {
        return false;
    }
    if (!source) {
        return true;
    }
    if (arg.type === "TemplateLiteral" && arg.quasis.length === 1 && arg.quasis[0].type === "TemplateElement") {
        return arg.quasis[0].value.cooked === source;
    }
    return arg.value === source;
}
export { createScope, visitScope, visitBinding, deleteScope, getNearestScope, getScope, getBinding, isMemberExpression, isFunction, isRequire };
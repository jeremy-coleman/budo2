function simple(node, visitors, baseVisitor, state, override) {
    if (!baseVisitor)
        baseVisitor = base;
    (function c(node, st, override) {
        let type = override || node.type, found = visitors[type];
        baseVisitor[type](node, st, c);
        if (found)
            found(node, st);
    })(node, state, override);
}
function ancestor(node, visitors, baseVisitor, state, override) {
    let ancestors = [];
    if (!baseVisitor)
        baseVisitor = base;
    (function c(node, st, override) {
        let type = override || node.type, found = visitors[type];
        let isNew = node !== ancestors[ancestors.length - 1];
        if (isNew)
            ancestors.push(node);
        baseVisitor[type](node, st, c);
        if (found)
            found(node, st || ancestors, ancestors);
        if (isNew)
            ancestors.pop();
    })(node, state, override);
}
function recursive(node, state, funcs, baseVisitor, override) {
    let visitor = funcs ? make(funcs, baseVisitor || undefined) : baseVisitor;
    (function c(node, st, override) {
        visitor[override || node.type](node, st, c);
    })(node, state, override);
}
function makeTest(test) {
    if (typeof test === "string")
        return (type) => type === test;
    else if (!test)
        return () => true;
    else
        return test;
}
class Found {
    constructor(node, state) {
        this.node = node;
        this.state = state;
    }
}
function full(node, callback, baseVisitor, state, override) {
    if (!baseVisitor)
        baseVisitor = base;
    (function c(node, st, override) {
        let type = override || node.type;
        baseVisitor[type](node, st, c);
        if (!override)
            callback(node, st, type);
    })(node, state, override);
}
function fullAncestor(node, callback, baseVisitor, state) {
    if (!baseVisitor)
        baseVisitor = base;
    let ancestors = [];
    (function c(node, st, override) {
        let type = override || node.type;
        let isNew = node !== ancestors[ancestors.length - 1];
        if (isNew)
            ancestors.push(node);
        baseVisitor[type](node, st, c);
        if (!override)
            callback(node, st || ancestors, ancestors, type);
        if (isNew)
            ancestors.pop();
    })(node, state);
}
function findNodeAt(node, start, end, test, baseVisitor, state) {
    if (!baseVisitor)
        baseVisitor = base;
    test = makeTest(test);
    try {
        ;
        (function c(node, st, override) {
            let type = override || node.type;
            if ((start == null || node.start <= start) &&
                (end == null || node.end >= end))
                baseVisitor[type](node, st, c);
            if ((start == null || node.start === start) &&
                (end == null || node.end === end) &&
                test(type, node))
                throw new Found(node, st);
        })(node, state);
    }
    catch (e) {
        if (e instanceof Found)
            return e;
        throw e;
    }
}
function findNodeAround(node, pos, test, baseVisitor, state) {
    test = makeTest(test);
    if (!baseVisitor)
        baseVisitor = base;
    try {
        ;
        (function c(node, st, override) {
            let type = override || node.type;
            if (node.start > pos || node.end < pos)
                return;
            baseVisitor[type](node, st, c);
            if (test(type, node))
                throw new Found(node, st);
        })(node, state);
    }
    catch (e) {
        if (e instanceof Found)
            return e;
        throw e;
    }
}
function findNodeAfter(node, pos, test, baseVisitor, state) {
    test = makeTest(test);
    if (!baseVisitor)
        baseVisitor = base;
    try {
        ;
        (function c(node, st, override) {
            if (node.end < pos)
                return;
            let type = override || node.type;
            if (node.start >= pos && test(type, node))
                throw new Found(node, st);
            baseVisitor[type](node, st, c);
        })(node, state);
    }
    catch (e) {
        if (e instanceof Found)
            return e;
        throw e;
    }
}
function findNodeBefore(node, pos, test, baseVisitor, state) {
    test = makeTest(test);
    if (!baseVisitor)
        baseVisitor = base;
    let max;
    (function c(node, st, override) {
        if (node.start > pos)
            return;
        let type = override || node.type;
        if (node.end <= pos &&
            (!max || max.node.end < node.end) &&
            test(type, node))
            max = new Found(node, st);
        baseVisitor[type](node, st, c);
    })(node, state);
    return max;
}
function make(funcs, baseVisitor) {
    let visitor = Object.create(baseVisitor || base);
    for (let type in funcs)
        visitor[type] = funcs[type];
    return visitor;
}
function skipThrough(node, st, c) {
    c(node, st);
}
function ignore(...args) { }
let base = (() => {
    class base {
    }
    base.BlockStatement = (node, st, c) => {
        for (let stmt of node.body)
            c(stmt, st, "Statement");
    };
    base.Program = base.BlockStatement;
    base.Statement = skipThrough;
    base.EmptyStatement = ignore;
    base.ParenthesizedExpression = (node, st, c) => c(node.expression, st, "Expression");
    base.ExpressionStatement = base.ParenthesizedExpression;
    base.IfStatement = (node, st, c) => {
        c(node.test, st, "Expression");
        c(node.consequent, st, "Statement");
        if (node.alternate)
            c(node.alternate, st, "Statement");
    };
    base.LabeledStatement = (node, st, c) => c(node.body, st, "Statement");
    base.BreakStatement = ignore;
    base.ContinueStatement = ignore;
    base.WithStatement = (node, st, c) => {
        c(node.object, st, "Expression");
        c(node.body, st, "Statement");
    };
    base.SwitchStatement = (node, st, c) => {
        c(node.discriminant, st, "Expression");
        for (let cs of node.cases) {
            if (cs.test)
                c(cs.test, st, "Expression");
            for (let cons of cs.consequent)
                c(cons, st, "Statement");
        }
    };
    base.SwitchCase = (node, st, c) => {
        if (node.test)
            c(node.test, st, "Expression");
        for (let cons of node.consequent)
            c(cons, st, "Statement");
    };
    base.ReturnStatement = (node, st, c) => {
        if (node.argument)
            c(node.argument, st, "Expression");
    };
    base.YieldExpression = base.ReturnStatement;
    base.AwaitExpression = base.ReturnStatement;
    base.SpreadElement = (node, st, c) => c(node.argument, st, "Expression");
    base.ThrowStatement = base.SpreadElement;
    base.TryStatement = (node, st, c) => {
        c(node.block, st, "Statement");
        if (node.handler)
            c(node.handler, st);
        if (node.finalizer)
            c(node.finalizer, st, "Statement");
    };
    base.CatchClause = (node, st, c) => {
        if (node.param)
            c(node.param, st, "Pattern");
        c(node.body, st, "Statement");
    };
    base.DoWhileStatement = (node, st, c) => {
        c(node.test, st, "Expression");
        c(node.body, st, "Statement");
    };
    base.WhileStatement = base.DoWhileStatement;
    base.ForStatement = (node, st, c) => {
        if (node.init)
            c(node.init, st, "ForInit");
        if (node.test)
            c(node.test, st, "Expression");
        if (node.update)
            c(node.update, st, "Expression");
        c(node.body, st, "Statement");
    };
    base.ForOfStatement = (node, st, c) => {
        c(node.left, st, "ForInit");
        c(node.right, st, "Expression");
        c(node.body, st, "Statement");
    };
    base.ForInStatement = base.ForOfStatement;
    base.ForInit = (node, st, c) => {
        if (node.type === "VariableDeclaration")
            c(node, st);
        else
            c(node, st, "Expression");
    };
    base.DebuggerStatement = ignore;
    base.FunctionDeclaration = (node, st, c) => c(node, st, "Function");
    base.VariableDeclaration = (node, st, c) => {
        for (let decl of node.declarations)
            c(decl, st);
    };
    base.VariableDeclarator = (node, st, c) => {
        c(node.id, st, "Pattern");
        if (node.init)
            c(node.init, st, "Expression");
    };
    base.Function = (node, st, c) => {
        if (node.id)
            c(node.id, st, "Pattern");
        for (let param of node.params)
            c(param, st, "Pattern");
        c(node.body, st, node.expression ? "Expression" : "Statement");
    };
    base.Pattern = (node, st, c) => {
        if (node.type === "Identifier")
            c(node, st, "VariablePattern");
        else if (node.type === "MemberExpression")
            c(node, st, "MemberPattern");
        else
            c(node, st);
    };
    base.VariablePattern = ignore;
    base.MemberPattern = skipThrough;
    base.RestElement = (node, st, c) => c(node.argument, st, "Pattern");
    base.ArrayPattern = (node, st, c) => {
        for (let elt of node.elements) {
            if (elt)
                c(elt, st, "Pattern");
        }
    };
    base.ObjectPattern = (node, st, c) => {
        for (let prop of node.properties) {
            if (prop.type === "Property") {
                if (prop.computed)
                    c(prop.key, st, "Expression");
                c(prop.value, st, "Pattern");
            }
            else if (prop.type === "RestElement") {
                c(prop.argument, st, "Pattern");
            }
        }
    };
    base.Expression = skipThrough;
    base.ThisExpression = ignore;
    base.Super = ignore;
    base.MetaProperty = ignore;
    base.ArrayExpression = (node, st, c) => {
        for (let elt of node.elements) {
            if (elt)
                c(elt, st, "Expression");
        }
    };
    base.ObjectExpression = (node, st, c) => {
        for (let prop of node.properties)
            c(prop, st);
    };
    base.ArrowFunctionExpression = base.FunctionDeclaration;
    base.FunctionExpression = base.FunctionDeclaration;
    base.SequenceExpression = (node, st, c) => {
        for (let expr of node.expressions)
            c(expr, st, "Expression");
    };
    base.TemplateLiteral = (node, st, c) => {
        for (let quasi of node.quasis)
            c(quasi, st);
        for (let expr of node.expressions)
            c(expr, st, "Expression");
    };
    base.TemplateElement = ignore;
    base.UpdateExpression = (node, st, c) => {
        c(node.argument, st, "Expression");
    };
    base.UnaryExpression = base.UpdateExpression;
    base.LogicalExpression = (node, st, c) => {
        c(node.left, st, "Expression");
        c(node.right, st, "Expression");
    };
    base.BinaryExpression = base.LogicalExpression;
    base.AssignmentPattern = (node, st, c) => {
        c(node.left, st, "Pattern");
        c(node.right, st, "Expression");
    };
    base.AssignmentExpression = base.AssignmentPattern;
    base.ConditionalExpression = (node, st, c) => {
        c(node.test, st, "Expression");
        c(node.consequent, st, "Expression");
        c(node.alternate, st, "Expression");
    };
    base.CallExpression = (node, st, c) => {
        c(node.callee, st, "Expression");
        if (node.arguments)
            for (let arg of node.arguments)
                c(arg, st, "Expression");
    };
    base.NewExpression = base.CallExpression;
    base.MemberExpression = (node, st, c) => {
        c(node.object, st, "Expression");
        if (node.computed)
            c(node.property, st, "Expression");
    };
    base.ExportDefaultDeclaration = (node, st, c) => {
        if (node.declaration)
            c(node.declaration, st, node.type === "ExportNamedDeclaration" || node.declaration.id
                ? "Statement"
                : "Expression");
        if (node.source)
            c(node.source, st, "Expression");
    };
    base.ExportNamedDeclaration = base.ExportDefaultDeclaration;
    base.ExportAllDeclaration = (node, st, c) => {
        c(node.source, st, "Expression");
    };
    base.ImportDeclaration = (node, st, c) => {
        for (let spec of node.specifiers)
            c(spec, st);
        c(node.source, st, "Expression");
    };
    base.ImportExpression = (node, st, c) => {
        c(node.source, st, "Expression");
    };
    base.ImportSpecifier = ignore;
    base.ImportDefaultSpecifier = ignore;
    base.ImportNamespaceSpecifier = ignore;
    base.Identifier = ignore;
    base.Literal = ignore;
    base.TaggedTemplateExpression = (node, st, c) => {
        c(node.tag, st, "Expression");
        c(node.quasi, st, "Expression");
    };
    base.ClassExpression = (node, st, c) => c(node, st, "Class");
    base.ClassDeclaration = base.ClassExpression;
    base.Class = (node, st, c) => {
        if (node.id)
            c(node.id, st, "Pattern");
        if (node.superClass)
            c(node.superClass, st, "Expression");
        c(node.body, st);
    };
    base.ClassBody = (node, st, c) => {
        for (let elt of node.body)
            c(elt, st);
    };
    base.Property = (node, st, c) => {
        if (node.computed)
            c(node.key, st, "Expression");
        c(node.value, st, "Expression");
    };
    base.MethodDefinition = base.Property;
    return base;
})();
const walk = {
    base,
    simple,
    ancestor,
    recursive,
    full,
    fullAncestor,
    findNodeAt,
    findNodeAround,
    findNodeAfter,
    findNodeBefore,
    make
};
export { walk };
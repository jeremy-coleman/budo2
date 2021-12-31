const GLOBAL_NAME = 'window';
const VAR_KIND = 'var';

function isFunction(v) {
  return typeof v === 'function';
}

module.exports = function (babel) {
  const { types: t, template } = babel;

  function getGlobalVar(path, src, opts, isRequire) {
    const { 
      globals = {}, 
      removes = [],
    } = opts;

    if (removes.some(v => {
      let matched 
        = v instanceof RegExp 
          ? v.test(src) 
          : isFunction(v)
            ? v(src)
            : (v === src);

      if (!matched) return;
      if (isRequire && !t.isExpressionStatement(path.parent)) {
        path.replaceWith(t.objectExpression([]));
      } else if (t.isImportDeclaration(path.node) && path.node.specifiers.length) {
        transformExpr(path, src, t.objectExpression([]), opts);
      } else path.remove();
      return true;
    })) return;

    let globalVar = isFunction(globals) ? globals(src) : globals[src];
    if (isFunction(globalVar)) globalVar = globalVar(src);

    return globalVar;
  }

  function getExpr(globalVar, opts) {
    const { 
      global: globalName = GLOBAL_NAME, 
      namespace
    } = opts;

    let str = globalName;
    if (namespace) str = namespace.includes('-') ? `${str}["${namespace}"]` : `${str}.${namespace}`;
    if (globalVar) str = globalVar.includes('-') ? `${str}["${globalVar}"]` : `${str}.${globalVar}`;
    return template(str)().expression;
  }

  function transformExpr(path, src, expr, opts) {
    const { 
      namespace,
      varKind = VAR_KIND
    } = opts;
    const { node } = path;

    if (node.specifiers.length === 1
      && (node.specifiers[0].type === 'ImportDefaultSpecifier'
        || node.specifiers[0].type === 'ImportNamespaceSpecifier')
    ) {
      let identifier = node.specifiers[0].local.name;
      path.replaceWith(
        t.variableDeclaration(varKind, [
          t.variableDeclarator(t.identifier(identifier), expr)
        ])
      );
    } else if (node.specifiers) {
      node.specifiers.forEach(({ type, imported, local }) => {
        if (type === 'ImportDefaultSpecifier') {
          path.insertBefore(
            t.variableDeclaration(varKind, [
              t.variableDeclarator(t.identifier(local.name), expr)
            ])
          );
          path.getSibling(path.key - 1).stop();
        } else if (imported.name === 'default') {
          path.insertBefore(
            t.variableDeclaration(varKind, [
              t.variableDeclarator(t.identifier(local.name), expr)
            ])
          );
          path.getSibling(path.key - 1).stop();
        } else if (src === namespace) {
          path.insertBefore(
            t.variableDeclaration(varKind, [
              t.variableDeclarator(t.identifier(local.name), expr)
            ])
          );
          path.getSibling(path.key - 1).stop();
        } else {
          path.insertBefore(
            t.variableDeclaration(varKind, [
              t.variableDeclarator(
                t.identifier(local.name),
                template(`$EXPR$.${imported.name}`)({ $EXPR$: expr }).expression
              )
            ])
          );
          path.getSibling(path.key - 1).stop();
        }
      });
      path.remove();
    }
  }

  return {
    name: 'babel-plugin-import-global',
    visitor: {
      ImportDeclaration(path, state) {
        let { node } = path;
        const { namespace, } = state.opts;

        let src = node.source.value;
        let globalVar = getGlobalVar(path, src, state.opts);

        if (src !== namespace && !globalVar) return;

        transformExpr(path, src, getExpr(globalVar, state.opts), state.opts);
      },
      CallExpression(path, state) {
        let { node } = path;

        if (!t.isIdentifier(node.callee) 
         || node.callee.name !== 'require'
         || node.arguments.length !== 1
         || !t.isStringLiteral(node.arguments[0])) return;

        let src = node.arguments[0].value;
        let globalVar = getGlobalVar(path, src, state.opts, true);
        if (!globalVar) return;

        path.replaceWith(getExpr(globalVar, state.opts));
      }
    }
  };
};
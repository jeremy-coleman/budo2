var unstringRequires = (input = "") => {
    return String(input).replace(/require\((["'`])(.*?)\1\)/g, (s) => s.replace(/["'`]/g, "_magic_require_"));
};
var restringRequires = (input = "") => {
    return String(input).replace(/require\((_magic_require_)(.*?)\1\)/g, (s) => s.replace(/_magic_require_/g, '"'));
};
var extractUniqueRequires = (input = "") => {
    return unique([...String(input).matchAll(/require\((["'`])(.*?)\1\)/g)].map((v) => v[2]));
};
var extractRawRequires = (input = "") => {
    let code = [].concat(String(input).match(/require\((["'`])(.*?)\1\)/g));
    return code;
};
var normalizeRequires = (input) => {
    return String(input).replace(/require\((["'`])(.*?)\1\)/g, (s) => s.replace(/['`]/g, `"`));
};
var removeComments = (string) => {
    return string.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
};
var unique = (arr) => [...new Set([...arr].flat())].filter((v) => v);
var pipe = (...fns) => (x) => fns.reduce((v, f) => f(v), x);
var extractRunnableTemplateCode = (input = "") => {
    return input.match(/(\$\{[\s]*.*?[\s]*\})/g);
};
var extractTemplateRequires = (input = "") => {
    return pipe(extractRunnableTemplateCode, extractRawRequires)(input);
};
var preprocessCode = (input = "") => {
    return pipe(removeComments, normalizeRequires)(input);
};
let detective = (input = "") => {
    let str = preprocessCode(input);
    let extracted_template_requires = extractTemplateRequires(str);
    str = unstringRequires(str);
    while (str != (str = str.replace(/(\$\{[\s]*.*?[\s]*\})/g, "")))
        while (str != (str = str.replace(/`[^`]*?`/g, "")))
            while (str != (str = str.replace(/"[^"]*"/g, "")))
                while (str != (str = str.replace(/'[^']*'/g, "")))
                    break;
    str = restringRequires(str);
    str += extracted_template_requires;
    //console.log(str)
    let out = extractUniqueRequires(str);
    return out;
};

module.exports = detective

//export { detective };

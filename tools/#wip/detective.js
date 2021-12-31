function removeComments(string) {
  return string.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").trim()
}

const findImports = (code_string) => {
  let _code_string = removeComments(code_string)
  return [
    ...new Set(
      [
        [..._code_string.matchAll(/require\((["'])(.*?)\1\)/g)].map((v) => v[2]),
        //[..._code_string.matchAll(/import\((["'])(.*?)\1\)/g)].map((v) => v[2]),
        //[..._code_string.matchAll(/from (["'])(.*?)\1/g)].map((v) => v[2])
      ].flat()
    )
  ]
}
const detective = (code_string) => {
  return findImports(code_string)
}

module.exports = detective

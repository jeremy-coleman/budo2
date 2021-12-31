var fs = require('fs')
const babel = require('@babel/core')
const syntaxTypeScript = require('@babel/plugin-syntax-typescript')
const extractExport = require('babel-plugin-extract-export')

const jsx = `
import { Image } from 'system'

export const Avatar = () => <Image />

type SystemProps = { as: any }

type BoxProps = { children: any } & SystemProps

export const Box = (props: BoxProps) => <div {...props} />
`

const result = babel.transform(jsx, {
  configFile: false,
  plugins: [
    [syntaxTypeScript, { isTSX: true }],
    [extractExport, { exportName: 'Avatar' }],
  ],
})

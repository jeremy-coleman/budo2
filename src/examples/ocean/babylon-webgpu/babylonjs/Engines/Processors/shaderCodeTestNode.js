import { ShaderCodeNode } from './shaderCodeNode.js';

/** @hidden */
class ShaderCodeTestNode extends ShaderCodeNode {
    isValid(preprocessors) {
        return this.testExpression.isTrue(preprocessors);
    }
}

export { ShaderCodeTestNode };

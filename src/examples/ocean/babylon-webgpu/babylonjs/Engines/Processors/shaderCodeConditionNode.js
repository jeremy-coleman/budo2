import { ShaderCodeNode } from './shaderCodeNode.js';

/** @hidden */
class ShaderCodeConditionNode extends ShaderCodeNode {
    process(preprocessors, options) {
        for (var index = 0; index < this.children.length; index++) {
            let node = this.children[index];
            if (node.isValid(preprocessors)) {
                return node.process(preprocessors, options);
            }
        }
        return "";
    }
}

export { ShaderCodeConditionNode };

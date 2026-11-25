package com.kb.quality;

/** 论文摘要常残留 LaTeX 命令，直接渲染会显示 \\textbf{...} 这种源码。 */
public class LatexRule implements QualityRule {

    private static final String[] MARKERS = {
            "\\textbf{", "\\emph{", "\\frac{", "\\begin{", "\\text{", "\\mathrm{", "\\cite{"
    };

    @Override
    public String id() {
        return "latex_residue";
    }

    @Override
    public int penalty(QualityInput input) {
        String text = input.combined();
        for (String marker : MARKERS) {
            if (text.contains(marker)) return 100;
        }
        return 0;
    }

    @Override
    public String reason() {
        return "残留 LaTeX 命令未清理";
    }
}

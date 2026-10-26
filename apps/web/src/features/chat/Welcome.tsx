import { TextReveal } from "@/components/ui/text-reveal";

export function Welcome() {
  return (
    <div className="chat-welcome">
      <TextReveal
        as="h1"
        text="今天，想一起完成什么？"
        by="char"
        stagger={25}
        duration={500}
      />
      <p>梳理想法、处理文件，或把一项任务交给 DSH。</p>
    </div>
  );
}

export const suggestions = [
  {
    title: "分析问题",
    prompt: "我想分析一个问题，请先帮我明确目标和已有信息。",
  },
  {
    title: "梳理文件",
    prompt: "请先只读查看当前工作目录，概括文件结构，不要修改文件。",
  },
  {
    title: "制定计划",
    prompt: "请帮我把一个想法拆成可执行的步骤，先问我需要完成什么。",
  },
];

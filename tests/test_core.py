import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

import ai_agent
import package_builder


class CoreTests(unittest.TestCase):
    def test_three_question_hard_limit(self):
        session={"questions_used":3,"messages":[],"state":{"summary":"","facts":[],"self_reports":[],"inferences":[],"open_questions":[]},"evidence":[]}
        result=ai_agent.decide_turn(session)
        self.assertEqual(result["action"],"finish")

    def test_demo_question_is_single_and_short(self):
        session={"questions_used":0,"messages":[{"role":"user","content":"一次旅行经历"}],"state":{},"evidence":[]}
        result=ai_agent.demo_decision(session)
        self.assertEqual(result["action"],"ask")
        self.assertLessEqual(len(result["question"]),55)
        self.assertLessEqual(result["question"].count("？"),1)

    def test_markdown_keeps_unknowns(self):
        package={"title":"测试","one_sentence_summary":"摘要","narrative":"原文","context":"背景","events":[],"skills":[],"self_reported_emotions":[],"decisions":[],"outcome":"未提及","reflection":"未提及","unknowns":["结局未提及"]}
        self.assertIn("结局未提及",package_builder.markdown(package))


if __name__=="__main__":unittest.main()


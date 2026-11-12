import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Analysis, AssistantContextInput, ChatMessage, DemoAdvice, DemoReply, Simulation } from '../shared/types.js';
import { request } from './api.js';
import { money } from './format.js';

const prompts = ['当前有哪些超限？', '现金和总资产怎么算？', '这一步发生了什么？', '给我一个调仓思路'];

export default function AiAssistant({ context, analysis, sourceName, snapshotId, onAdopt }: {
  context: AssistantContextInput; analysis: Analysis; sourceName: string; snapshotId: string; onAdopt: (result: Simulation) => void;
}) {
  const [view, setView] = useState<'chat' | 'advice'>('chat');
  const [advice, setAdvice] = useState<DemoAdvice | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastTopic, setLastTopic] = useState<DemoReply['topic'] | undefined>();
  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatList = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chatList.current) chatList.current.scrollTop = chatList.current.scrollHeight; }, [messages, chatLoading]);
  async function generate() {
    if (adviceLoading) return;
    setAdviceLoading(true); setAdviceError('');
    try { setAdvice(await request<DemoAdvice>('/assistant/advice', { context })); }
    catch (error) { setAdviceError(error instanceof Error ? error.message : '演示建议生成失败，请重试。'); }
    finally { setAdviceLoading(false); }
  }
  async function send(text = question) {
    if (chatLoading) return;
    const value = text.trim();
    if (!value || value.length > 1000) { setChatError('请输入 1～1000 个字符的问题。'); return; }
    setChatLoading(true); setChatError('');
    try {
      const answer = await request<DemoReply>('/assistant/chat', { context, question: value, history: messages.slice(-6), ...(lastTopic ? { topic: lastTopic } : {}) });
      setMessages(previous => [...previous, { role: 'user', content: value }, { role: 'assistant', content: answer.reply }]);
      setLastTopic(answer.topic);
      setQuestion('');
    } catch (error) { setChatError(error instanceof Error ? error.message : '回复失败，请重试。'); }
    finally { setChatLoading(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(); }
  return <div className="assistant-workspace">
    <div className="demo-mode-banner"><span className="demo-spark" aria-hidden="true">✧</span><div><strong>演示模式 · 本地规则生成</strong><p>未接入真实模型。建议与回复使用当前组合及固定规则，便于演示完整交互。</p></div><span className="demo-label">DEMO</span></div>
    <div className="assistant-context"><div><span className="assistant-source-dot" /><strong>{sourceName}</strong><span>{context.stepIndex === 0 ? '原始组合' : `第 ${context.stepIndex} 步`}</span><span>快照 {snapshotId}</span>{(context.planId || context.sourcePlanId) && <span>来源方案快照</span>}</div><div><span>总资产 <strong>¥{money(analysis.totalAssets)}</strong></span><span>现金 <strong>¥{money(analysis.cash)}</strong></span><span>超限 <strong>{analysis.alerts.length} 项</strong></span></div></div>
    <div className="assistant-switch" role="group" aria-label="助手功能"><button aria-label="切换到对话问答" aria-pressed={view === 'chat'} onClick={() => setView('chat')}>对话问答</button><button aria-label="查看辅助建议" aria-pressed={view === 'advice'} onClick={() => setView('advice')}>辅助建议</button></div>
    <div className="assistant-grid">
      <section className="panel assistant-advice" hidden={view !== 'advice'}><div className="section-heading"><div><h2>辅助建议</h2><p>从当前集中度出发，预览一个可验算的模拟草案。</p></div><span className="view-badge blue">规则演示</span></div>
        <div className="advice-body"><button className="primary full-width" disabled={adviceLoading} onClick={generate}>{adviceLoading ? '正在生成演示建议…' : advice ? '重新生成演示建议' : '生成演示建议'}</button>
          {adviceError && <div className="error-box" role="alert">{adviceError}</div>}
          {!advice && !adviceLoading && <div className="advice-empty"><span>✧</span><h3>先看清问题，再比较调整</h3><p>生成后会列出超限依据、调整思路及后端验算结果。采用前，当前组合保持不变。</p></div>}
          {advice && <div className="advice-result"><h3>组合解读</h3><p>{advice.summary}</p>{advice.observations.length > 0 && <ul>{advice.observations.map((text, i) => <li key={i}>{text}</li>)}</ul>}<h3>演示思路</h3><p>{advice.suggestion}</p>
            {advice.draft && <article className="assistant-draft"><div className="draft-heading"><h3>{advice.draft.title}</h3><span>后端验算通过</span></div><ul>{advice.draft.addedOperations.map((op, i) => <li key={i}><span>卖出</span><strong>{advice.context.analysis.positions.find(p => p.symbol === op.symbol)?.name} <small>{op.symbol}</small></strong><strong>{op.quantity.toLocaleString('en-US')} 股</strong></li>)}</ul>
              <div className="draft-preview"><div><span>模拟现金</span><p>¥{money(advice.context.analysis.cash)} <i>→</i> <strong>¥{money(advice.draft.simulation.simulated.cash)}</strong></p></div><div><span>集中度超限</span><p>{advice.context.analysis.alerts.length} 项 <i>→</i> <strong>{advice.draft.simulation.simulated.alerts.length} 项</strong></p></div></div>
              <button className="secondary full-width" onClick={() => onAdopt(advice.draft!.simulation)}>采用为新模拟 <span aria-hidden="true">→</span></button><small className="field-hint">采用后进入可编辑草稿，由你决定是否命名保存。</small>
            </article>}
          </div>}
        </div>
      </section>

      <section className="panel assistant-chat" hidden={view !== 'chat'}><div className="section-heading"><div><h2>对话问答</h2><p>结合当前步骤，聊聊集中度、规则与操作变化。</p></div><button className="text-button" disabled={chatLoading || !messages.length} onClick={() => { setMessages([]); setLastTopic(undefined); setChatError(''); setQuestion(''); }}>清空对话</button></div>
        <div className="chat-thread" role="log" aria-label="演示对话记录" aria-live="polite" ref={chatList}>
          {!messages.length && <div className="chat-empty"><span className="chat-avatar">✧</span><strong>你好，我是组合演示助手</strong><p>可以先问“当前有哪些超限”，也可以在回复后继续追问。这里展示的是本地规则问答。</p></div>}
          {messages.map((message, i) => <article className={`chat-message ${message.role}`} key={i}><span>{message.role === 'user' ? '你' : '演示助手 · 本地规则'}</span><p>{message.content}</p></article>)}
          {chatLoading && <p className="chat-loading" role="status"><span className="spinner" />正在生成演示回复…</p>}
        </div>
        <div className="chat-composer"><div className="chat-prompts">{prompts.map(prompt => <button key={prompt} disabled={chatLoading} onClick={() => void send(prompt)}>{prompt}</button>)}</div>
          {chatError && <div className="error-box" role="alert">{chatError}</div>}
          <form onSubmit={submit}><label htmlFor="assistant-question" className="sr-only">输入你的问题</label><textarea id="assistant-question" rows={3} maxLength={1000} placeholder="例如：为什么科技行业超限？" value={question} disabled={chatLoading} onChange={e => setQuestion(e.target.value)} /><div><small>仅引用当前组合；切换数据或步骤会开始新会话。</small><button className="primary" type="submit" disabled={chatLoading || !question.trim()}>发送</button></div></form>
        </div>
      </section>
    </div>
  </div>;
}

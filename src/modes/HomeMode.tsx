import type { AppMode } from '../types';

interface HomeModeProps { onNavigate: (mode: AppMode) => void }

export function HomeMode({ onNavigate }: HomeModeProps) {
  return (
    <div className="home-page">
      <section className="hero-card"><div><span className="mode-kicker">TODAY'S PRACTICE</span><h1>見て、弾く。<br /><em>迷う前に。</em></h1><p>コードネームから手の形へ。MIDIキーボードをつないで、反応速度を鍛えましょう。</p><button className="button primary hero-button" type="button" onClick={() => onNavigate('sprint')}>瞬発練習を始める <span>→</span></button></div><div className="hero-visual" aria-hidden="true"><div className="floating-chord back">Am</div><div className="floating-chord front">C<small>基本形</small></div><div className="speed-mark">1.24<small>sec</small></div></div></section>
      <div className="feature-grid">
        <button className="feature-card song" type="button" onClick={() => onNavigate('songPractice')}><span className="feature-icon">♪</span><small>PLAY WITH A SONG</small><strong>曲で弾く</strong><p>原曲を聴きながら、次のコードと鍵盤の形を先読み。</p><i>曲を選ぶ →</i></button>
        <button className="feature-card cyan" type="button" onClick={() => onNavigate('sprint')}><span className="feature-icon">⌁</span><small>REACTION</small><strong>コード瞬発</strong><p>ランダム出題で、コードを押さえる反応速度を磨く。</p><i>始める →</i></button>
        <button className="feature-card violet" type="button" onClick={() => onNavigate('progression')}><span className="feature-icon">↗</span><small>FLOW</small><strong>コード進行</strong><p>定番進行をテンポに合わせ、流れの中で身につける。</p><i>始める →</i></button>
        <button className="feature-card coral" type="button" onClick={() => onNavigate('sixty')}><span className="feature-icon">60</span><small>CHALLENGE</small><strong>60秒チェンジ</strong><p>2コードを交互に。1分間の自己ベストへ挑戦。</p><i>挑戦する →</i></button>
      </div>
      <button className="curriculum-banner" type="button" onClick={() => onNavigate('curriculum')}><div><small>14 DAY PROGRAM</small><strong>段階的に身につく、14日間の練習プラン</strong><span>基礎コードから実曲・最終テストまで、毎日の記録を残せます。</span></div><i>プランを見る →</i></button>
    </div>
  );
}

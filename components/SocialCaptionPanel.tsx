import { useEffect, useMemo, useState } from 'react';
import { Copy, Save } from 'lucide-react';

export type SocialCaptions = {
  facebook: string;
  instagram: string;
  tiktok: string;
  youtube: string;
};

type Props = {
  title: string;
  niche: string;
  hook: string;
  caption: string;
  narration: string;
  hashtags: string[];
  value: SocialCaptions;
  onChange: (next: SocialCaptions) => void;
  onSave: (next: SocialCaptions) => Promise<void>;
};

const buildDefaults = (props: Omit<Props, 'value' | 'onChange' | 'onSave'>): SocialCaptions => {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const hook = clean(props.hook);
  const base = clean(props.caption) || hook || clean(props.narration).slice(0, 220);
  const sentences = props.narration
    .split(/(?<=[.!?])\s+/)
    .map(clean)
    .filter(Boolean)
    .slice(0, 3);
  const hashtags = props.hashtags.length
    ? props.hashtags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')
    : `#${props.niche.replace(/[^a-zA-Z0-9]+/g, '')} #Reels #Storytelling`;
  const supporting = sentences.filter(sentence => sentence !== base).slice(0, 2).join(' ');
  const facebook = [base, supporting, 'What do you think about this?', hashtags].filter(Boolean).join('\n\n');
  const instagram = [base, supporting, 'Save this reel if it speaks to you.', hashtags].filter(Boolean).join('\n\n');
  const tiktok = [base, supporting, 'Watch to the end and tell me your thoughts.', hashtags].filter(Boolean).join('\n\n');
  const youtube = [props.title, '', base, supporting, hashtags].filter(Boolean).join('\n\n');
  return { facebook, instagram, tiktok, youtube };
};

export default function SocialCaptionPanel({ title, niche, hook, caption, narration, hashtags, value, onChange, onSave }: Props) {
  const defaults = useMemo(() => buildDefaults({ title, niche, hook, caption, narration, hashtags }), [title, niche, hook, caption, narration, hashtags]);
  const [platform, setPlatform] = useState<keyof SocialCaptions>('facebook');
  const [saving, setSaving] = useState(false);
  const current = value[platform];

  useEffect(() => {
    const hasAny = Object.values(value).some(Boolean);
    if (!hasAny) onChange(defaults);
  }, [defaults, value, onChange]);

  const update = (text: string) => onChange({ ...value, [platform]: text });
  const reset = () => onChange({ ...value, [platform]: defaults[platform] });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current);
    } catch {
      return;
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sound-design-card social-caption-panel">
      <div className="card-label"><Save size={15}/> SOCIAL POST CAPTIONS</div>
      <strong>Platform-ready captions</strong>
      <span className="field-hint">The video subtitles stay short and readable. These captions are the text that accompanies the Reel when you publish it.</span>
      <div className="script-mode-tabs">
        {(['facebook', 'instagram', 'tiktok', 'youtube'] as const).map(item => (
          <button key={item} type="button" className={platform === item ? 'active' : ''} onClick={() => setPlatform(item)}>
            {item === 'facebook' ? 'Facebook' : item === 'instagram' ? 'Instagram' : item === 'tiktok' ? 'TikTok' : 'YouTube'}
          </button>
        ))}
      </div>
      {platform === 'facebook' && (
        <small className="field-hint">Facebook's feedback on this Reel suggests avoiding captions that are too short, so this version gives the post more context while staying editable.</small>
      )}
      <label className="editor-label">
        {platform[0].toUpperCase() + platform.slice(1)} caption
        <textarea rows={7} value={current} onChange={e => update(e.target.value)} placeholder="Write the caption that will accompany this Reel…" />
      </label>
      <div className="sound-design-actions">
        <button className="ghost action-btn" type="button" onClick={reset}>Reset suggestion</button>
        <button className="ghost action-btn" type="button" onClick={() => void copy()} disabled={!current}><Copy size={14}/> Copy</button>
        <button className="primary action-btn" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save captions'}</button>
      </div>
    </div>
  );
}

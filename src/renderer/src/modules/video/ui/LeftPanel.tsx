import { Captions, Film, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../../../core/i18n';
import { Tabs } from '../../../components/ui';

export type LeftTab = 'media' | 'graphics' | 'captions';

export function LeftPanel({ tab, setTab, children }: { tab: LeftTab; setTab: (t: LeftTab) => void; children: ReactNode }) {
  const t = useT();
  return (
    <div className="vd-left">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'media', label: t('Media'), icon: Film },
          { value: 'graphics', label: t('Titles'), icon: Type },
          { value: 'captions', label: t('Captions'), icon: Captions },
        ]}
      />
      <div className="vd-left-body">{children}</div>
    </div>
  );
}

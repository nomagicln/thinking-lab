/**
 * TraitDisplay.tsx — 把测量出来的 TraitProfile 接到共享的指标条组件上
 */

import { TRAIT_AXES, type TraitProfile } from '../lib/engine'
import { MeterList, MiniMeter, type MeterAxis } from '../../../shared/components/ui'
import { pctWhole } from '../lib/format'

const AXES: MeterAxis[] = TRAIT_AXES.map((a) => ({ key: a.key, label: a.label, hint: a.hint }))

export function profileText(profile: TraitProfile | undefined): string {
  if (!profile) return ''
  return TRAIT_AXES.map((ax) => `${ax.label} ${pctWhole(profile[ax.key])}`).join(' · ')
}

export function TraitBars(props: { profile?: TraitProfile; compact?: boolean }) {
  return (
    <MeterList
      axes={AXES}
      values={(props.profile ?? {}) as unknown as Record<string, number>}
      compact={props.compact}
    />
  )
}

export function TraitMini(props: {
  profile?: TraitProfile
  label: string
  onClick?: () => void
}) {
  return (
    <MiniMeter
      axes={AXES}
      values={(props.profile ?? {}) as unknown as Record<string, number>}
      label={`${props.label} 的行为特质`}
      title={profileText(props.profile) + (props.onClick ? '　（点击查看完整档案）' : '')}
      onClick={props.onClick}
    />
  )
}

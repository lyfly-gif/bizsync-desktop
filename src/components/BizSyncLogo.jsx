import { useId } from 'react';

export default function BizSyncLogo({ className = "w-8 h-8" }) {
  const id = useId();
  const gradMain = `grad-main-${id}`;
  const gradSync = `grad-sync-${id}`;

  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradMain} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4338CA" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
        <linearGradient id={gradSync} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect x="130" y="100" width="76" height="312" rx="38" fill={`url(#${gradMain})`} />
      <path d="M 168 138 H 284 C 330.39 138 368 175.61 368 222 C 368 268.39 330.39 306 284 306 H 168" stroke={`url(#${gradMain})`} strokeWidth="76" strokeLinecap="round" />
      <path d="M 168 256 H 308 C 361.02 256 404 298.98 404 352 C 404 405.02 361.02 448 308 448 H 168" stroke={`url(#${gradSync})`} strokeWidth="76" strokeLinecap="round" />
      <path d="M 400 120 C 400 120 420 120 420 100 C 420 120 440 120 440 120 C 440 120 420 120 420 140 C 420 120 400 120 400 120 Z" fill="#F59E0B" />
      <path d="M 430 160 C 430 160 440 160 440 150 C 440 160 450 160 450 160 C 450 160 440 160 440 170 C 440 160 430 160 430 160 Z" fill="#38BDF8" />
    </svg>
  );
}

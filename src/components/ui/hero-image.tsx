export function HeroImage({ className = "" }: { className?: string }) {
  return <picture>
    <source media="(max-width: 700px)" type="image/avif" srcSet="/images/landing/hero-mobile.avif" />
    <source type="image/avif" srcSet="/images/landing/hero.avif" />
    <source media="(max-width: 700px)" type="image/webp" srcSet="/images/landing/hero-mobile.webp" />
    <img className={`top-photo ${className}`} src="/images/landing/hero.webp" width={1600} height={1134} alt="サラダやオリーブ、グリル料理が並ぶテーブル" fetchPriority="high" loading="eager" />
  </picture>;
}

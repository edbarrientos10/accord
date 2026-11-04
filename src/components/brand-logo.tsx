import Image from 'next/image';

export function BrandLogo() {
  return (
    <Image
      className="brand-logo"
      src="/brand/accord-logo-dark-v2.webp"
      alt="Accord"
      width={960}
      height={301}
      unoptimized
      priority
    />
  );
}

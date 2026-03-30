type FeatureCardProps = {
  icon: React.ReactNode;
  title: string;
  desc: string;
};

export function FeatureCard({ icon, title, desc }: FeatureCardProps) {
  return (
    <div className="bg-card hover:bg-accent/50 border-border group flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors">
      <div className="bg-background ring-border rounded-full p-3 shadow-sm ring-1 transition-transform duration-300 group-hover:scale-110">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

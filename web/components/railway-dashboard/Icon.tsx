import {
  ArrowLeft, ArrowRight, Cable, Camera, ChartNoAxesCombined, ChevronRight,
  CircleCheck, CircleX, Clock, Download, Focus, Image, Info, LayoutDashboard,
  Map, MapPin, Maximize, Route, ScanLine, Search, Send, Sparkles, Square,
  Upload, Video, X, type LucideIcon, type LucideProps,
} from "lucide-react";

const icons = {
  overview: LayoutDashboard, map: Map, scan: ScanLine, report: ChartNoAxesCombined,
  route: Route, download: Download, upload: Upload, focus: Focus, search: Search,
  arrow: ArrowRight, back: ArrowLeft, close: X, check: CircleCheck, clock: Clock,
  cable: Cable, info: Info, expand: Maximize, chevron: ChevronRight, image: Image,
  dismissed: CircleX, location: MapPin, camera: Camera, video: Video,
  ai: Sparkles, stop: Square, send: Send,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({ name, ...props }: LucideProps & { name: IconName }) {
  const Component = icons[name];
  return <Component size={20} strokeWidth={1.8} aria-hidden="true" focusable="false" {...props} />;
}

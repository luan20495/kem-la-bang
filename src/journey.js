/**
 * @typedef {{
 *   id: string,
 *   order: number,
 *   day: string,
 *   time: string,
 *   role: string,
 *   name: string,
 *   place: string,
 *   blurb: string,
 *   lat: number,
 *   lng: number,
 *   mapsUrl: string,
 *   color: string,
 *   category?: string,
 *   rating?: number,
 *   reviews?: number,
 *   price?: string,
 *   address?: string,
 *   hours?: string,
 *   phone?: string,
 *   photos: {src: string, caption: string}[]
 * }} Stop
 */

/** Resolve public assets for both local, custom domain, and GitHub Pages subpath. */
function asset(path) {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${String(path).replace(/^\//, '')}`;
}

/** @type {Stop[]} */
export const stops = [
  {
    id: 'xuat-phat',
    order: 1,
    day: '15/08',
    time: '08:30',
    role: 'Tập trung & xuất phát',
    name: 'Southern Star',
    place: '897 Giải Phóng, Hà Nội',
    blurb:
      'Điểm hẹn sáng sớm — check-in, xếp xe, rồi lao vào ngày nắng rực phía trước.',
    lat: 20.9794135,
    lng: 105.8415574,
    mapsUrl: 'https://maps.app.goo.gl/AVMVcpGpbDYfXuxW9',
    color: '#FFC247',
    category: 'Chung cư',
    rating: 3.4,
    reviews: 34,
    address: '897 Giải Phóng, Hoàng Mai, Hà Nội',
    photos: [
      { src: asset('photos/xuat-phat/1.jpg'), caption: 'Southern Star · ngoại thất ngày' },
      { src: asset('photos/xuat-phat/2.jpg'), caption: 'Tổng thể & vườn trên cao' },
      { src: asset('photos/xuat-phat/3.jpg'), caption: 'Bể bơi tiện ích' },
    ],
  },
  {
    id: 'nghi-duong',
    order: 2,
    day: '15/08',
    time: 'Trưa+',
    role: 'Nghỉ dưỡng',
    name: 'Suối Kẹm Homestay',
    place: 'Đặc sản cá tầm · núi & suối',
    blurb:
      'Đích đến chính: núi, suối và không gian nghỉ — ở lại tới sáng hôm sau.',
    lat: 21.6227277,
    lng: 105.534959,
    mapsUrl: 'https://maps.app.goo.gl/hxBp9wbi6RPUZM216',
    color: '#1F7A5C',
    category: 'Nhà hàng · Homestay',
    rating: 4.6,
    reviews: 50,
    price: '₫200–300K',
    address: 'Khu DLST tự nhiên Tam Đảo, La Bằng, Thái Nguyên',
    hours: 'Mở 24 giờ',
    phone: '+84 977 226 183',
    photos: [
      { src: asset('photos/nghi-duong/1.jpg'), caption: 'Homestay dưới chân núi' },
      { src: asset('photos/nghi-duong/2.jpg'), caption: 'Suối Kẹm trong veo' },
      { src: asset('photos/nghi-duong/3.jpg'), caption: 'Mâm cơm đặc sản' },
    ],
  },
  {
    id: 'tra-chieu',
    order: 3,
    day: '15/08',
    time: 'Chiều',
    role: 'Trà chiều',
    name: 'Đợi Coffee',
    place: 'Đợi Coffee',
    blurb: 'Chậm lại một nhịp — trà, cà phê và ánh chiều nghiêng trên đồi.',
    lat: 21.58685,
    lng: 105.70005,
    mapsUrl: 'https://maps.app.goo.gl/NL9yKLToKoEF29W26',
    color: '#2F7FB5',
    category: 'Quán cà phê',
    rating: 4.9,
    reviews: 88,
    price: '₫1–100K',
    address: '16 Hồ Núi Cốc, Đại Phúc, Thái Nguyên',
    hours: 'Đang mở · Đóng 22:00',
    phone: '+84 989 679 669',
    photos: [
      { src: asset('photos/tra-chieu/1.jpg'), caption: 'Hoàng hôn trên hồ Núi Cốc' },
      { src: asset('photos/tra-chieu/2.jpg'), caption: 'Toàn cảnh hồ & đảo' },
      { src: asset('photos/tra-chieu/3.jpg'), caption: 'View đồi trà ven hồ' },
    ],
  },
  {
    id: 'mua-qua',
    order: 4,
    day: '16/08',
    time: 'Sáng',
    role: 'Mua quả khi ra về',
    name: 'Matcha Lạc Yên',
    place: 'Hợp tác xã trà · đặc sản mang về',
    blurb: 'Ghé mua quả & đặc sản trước khi xuôi Hà Nội — về nhà trước trưa.',
    lat: 21.6480136,
    lng: 105.5634686,
    mapsUrl: 'https://maps.app.goo.gl/sYb8Kx9AEAnUwKqX6',
    color: '#6AA33A',
    category: 'Xưởng trà · HTX',
    rating: 5.0,
    reviews: 2,
    address: 'Xóm, La Bằng, Thái Nguyên',
    hours: 'Đang mở · Đóng 17:30',
    phone: '+84 973 578 130',
    photos: [
      { src: asset('photos/mua-qua/1.jpg'), caption: 'Đồi matcha Lạc Yên' },
      { src: asset('photos/mua-qua/2.jpg'), caption: 'Trà & matcha mang về' },
      { src: asset('photos/mua-qua/3.jpg'), caption: 'Kẹo lạc đặc sản' },
    ],
  },
];

export const trip = {
  brand: 'Kẹm',
  title: 'Đi Giữa Trời Rực Rỡ',
  artist: 'Ngô Lan Hương',
  youtubeId: 'pjm2aXT3A2M',
  youtubeUrl: 'https://www.youtube.com/watch?v=pjm2aXT3A2M',
  youtubeMusicUrl: 'https://music.youtube.com/watch?v=Lwuxlb83LD8',
  start: '2026-08-15T08:30:00+07:00',
  end: '2026-08-16T12:00:00+07:00',
};

/** Route legs — đúng lịch trình thực tế. */
export const legs = [
  { from: 'xuat-phat', to: 'nghi-duong', label: 'Xuất phát → Homestay', longHaul: true },
  { from: 'nghi-duong', to: 'tra-chieu', label: 'Homestay → Trà chiều' },
  { from: 'tra-chieu', to: 'nghi-duong', label: 'Trà chiều → về Homestay', overnight: true },
  { from: 'nghi-duong', to: 'mua-qua', label: 'Homestay → Mua quả' },
  { from: 'mua-qua', to: 'xuat-phat', label: 'Về Hà Nội', return: true, longHaul: true },
];

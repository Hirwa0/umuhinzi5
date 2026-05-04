export type Language = 'en' | 'rw' | 'fr' | 'sw' | 'es' | 'pt' | 'zh' | 'ar' | 'hi';
export type Theme = 'light' | 'dark';
export type Tab = 'chat' | 'weather' | 'diagnosis' | 'market' | 'community' | 'settings';

export interface UserProfile {
  uid: string;
  displayName: string;
  email?: string;
  photoURL: string;
  language: Language;
  theme: Theme;
  notificationsEnabled: boolean;
  createdAt: string;
}

export interface Post {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string;
  content: string;
  imageUrl?: string;
  likes: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string;
  content: string;
  createdAt: string;
}

export interface CropPrice {
  id: string;
  name: string;
  price: string;
  unit: string;
  category: string;
  trend: 'up' | 'down' | 'stable';
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model';
  content: string;
  imageUrl?: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  lastMessage?: string;
  updatedAt: string;
  createdAt: string;
}

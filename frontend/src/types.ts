export interface TopicRiverData {
  generatedAt: string;
  description: string;
  statistics: {
    totalTopics: number;
    totalDurationHours?: number;
    yearRange: {
      start: number;
      end: number;
    };
    years: number[];
    topicsByEpisodeCount: Array<{
      id: string;
      name: string;
      count: number;
    }>;
    topicsByDuration?: Array<{
      id: string;
      name: string;
      hours: number;
    }>;
  };
  topics: {
    [key: string]: {
      id: string;
      name: string;
      description: string;
      totalEpisodes: number;
      totalTopics: number;
      totalDurationMinutes?: number;
      totalDurationHours?: number;
      yearData: Array<{
        year: number;
        count: number;
        totalDurationMinutes?: number;
        totalDurationHours?: number;
        episodes: Array<{
          number: number;
          date: string;
          title: string;
          durationMinutes?: number;
        }>;
      }>;
    };
  };
}

export interface ProcessedTopicData {
  id: string;
  name: string;
  yearValues: Map<number, number>;
  totalDuration: number;
  color: string;
}

export interface SpeakerRiverData {
  generatedAt: string;
  description: string;
  statistics: {
    totalSpeakers: number;
    totalEpisodes: number;
    totalAppearances: number;
    totalDurationHours: number;
    yearRange: {
      start: number;
      end: number;
    };
    years: number[];
    topSpeakersByEpisodeCount: Array<{
      id: string;
      name: string;
      count: number;
    }>;
  };
  speakers: Array<{
    id: string;
    name: string;
    totalEpisodes: number;
    totalDurationHours: number;
    firstAppearance: number;
    lastAppearance: number;
    timeline: Array<{
      year: number;
      episodeCount: number;
      durationHours: number;
      episodes: number[];
    }>;
  }>;
}

export interface ProcessedSpeakerData {
  id: string;
  name: string;
  yearValues: Map<number, number>;
  totalAppearances: number;
  color: string;
}


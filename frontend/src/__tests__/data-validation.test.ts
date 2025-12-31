import { describe, it, expect } from 'vitest';
import type { TopicRiverData, SpeakerRiverData, HeatmapData } from '../types';

describe('Data Validation and Edge Cases', () => {
  describe('TopicRiverData Validation', () => {
    it('should handle empty topics object', () => {
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test',
        statistics: {
          yearRange: { start: 2020, end: 2024 },
          years: [],
          topicsByEpisodeCount: []
        },
        topics: {}
      };
      
      expect(Object.keys(data.topics)).toHaveLength(0);
      expect(data.statistics.years).toHaveLength(0);
    });

    it('should handle topics with missing optional fields', () => {
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test',
        statistics: {
          yearRange: { start: 2020, end: 2024 },
          years: [2024],
          topicsByEpisodeCount: []
        },
        topics: {
          'topic-1': {
            id: 'topic-1',
            name: 'Test Topic',
            description: 'Description',
            totalEpisodes: 5,
            yearData: []
          }
        }
      };
      
      expect(data.topics['topic-1'].totalEpisodes).toBe(5);
      expect(data.topics['topic-1'].totalDurationMinutes).toBeUndefined();
    });

    it('should handle year data with occurrences', () => {
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test',
        statistics: {
          yearRange: { start: 2024, end: 2024 },
          years: [2024],
          topicsByEpisodeCount: []
        },
        topics: {
          'topic-1': {
            id: 'topic-1',
            name: 'Test',
            description: 'Test',
            totalEpisodes: 1,
            yearData: [{
              year: 2024,
              count: 1,
              episodes: [{
                number: 1,
                date: '2024-01-01',
                title: 'Episode 1',
                occurrences: [{
                  topic: 'Test Topic',
                  positionSec: 120,
                  durationSec: 300
                }]
              }]
            }]
          }
        }
      };
      
      const occurrence = data.topics['topic-1'].yearData[0].episodes[0].occurrences?.[0];
      expect(occurrence?.positionSec).toBe(120);
      expect(occurrence?.durationSec).toBe(300);
    });

    it('should handle large numbers of topics', () => {
      const topics: Record<string, any> = {};
      for (let i = 0; i < 1000; i++) {
        topics[`topic-${i}`] = {
          id: `topic-${i}`,
          name: `Topic ${i}`,
          description: 'Test',
          totalEpisodes: i,
          yearData: []
        };
      }
      
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Large dataset',
        statistics: {
          yearRange: { start: 2020, end: 2024 },
          years: [],
          topicsByEpisodeCount: []
        },
        topics
      };
      
      expect(Object.keys(data.topics)).toHaveLength(1000);
      expect(data.topics['topic-500'].totalEpisodes).toBe(500);
    });
  });

  describe('SpeakerRiverData Validation', () => {
    it('should handle speaker with no timeline', () => {
      const data: SpeakerRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test',
        statistics: {
          totalSpeakers: 1,
          totalEpisodes: 0,
          totalAppearances: 0,
          totalDurationHours: 0,
          yearRange: { start: 2024, end: 2024 },
          years: [],
          topSpeakersByEpisodeCount: []
        },
        speakers: [{
          id: 'speaker-1',
          name: 'Test Speaker',
          totalEpisodes: 0,
          totalDurationHours: 0,
          firstAppearance: 2024,
          lastAppearance: 2024,
          timeline: []
        }]
      };
      
      expect(data.speakers[0].timeline).toHaveLength(0);
      expect(data.speakers[0].totalEpisodes).toBe(0);
    });

    it('should handle speaker with multiple years', () => {
      const data: SpeakerRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test',
        statistics: {
          totalSpeakers: 1,
          totalEpisodes: 10,
          totalAppearances: 10,
          totalDurationHours: 20,
          yearRange: { start: 2020, end: 2024 },
          years: [2020, 2021, 2022, 2023, 2024],
          topSpeakersByEpisodeCount: []
        },
        speakers: [{
          id: 'speaker-1',
          name: 'Active Speaker',
          totalEpisodes: 10,
          totalDurationHours: 20,
          firstAppearance: 2020,
          lastAppearance: 2024,
          timeline: [
            { year: 2020, episodeCount: 2, durationHours: 4, episodes: [1, 2] },
            { year: 2021, episodeCount: 2, durationHours: 4, episodes: [3, 4] },
            { year: 2022, episodeCount: 2, durationHours: 4, episodes: [5, 6] },
            { year: 2023, episodeCount: 2, durationHours: 4, episodes: [7, 8] },
            { year: 2024, episodeCount: 2, durationHours: 4, episodes: [9, 10] }
          ]
        }]
      };
      
      expect(data.speakers[0].timeline).toHaveLength(5);
      expect(data.speakers[0].totalEpisodes).toBe(10);
      expect(data.speakers[0].totalDurationHours).toBe(20);
    });
  });

  describe('HeatmapData Validation', () => {
    it('should handle empty matrix', () => {
      const data: HeatmapData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Empty heatmap',
        statistics: {
          totalSpeakers: 0,
          totalClusters: 0,
          totalCombinations: 0,
          topSpeakersByEpisodes: []
        },
        speakers: [],
        clusters: [],
        matrix: []
      };
      
      expect(data.matrix).toHaveLength(0);
      expect(data.speakers).toHaveLength(0);
    });

    it('should handle speaker-cluster relationships', () => {
      const data: HeatmapData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test heatmap',
        statistics: {
          totalSpeakers: 1,
          totalClusters: 2,
          totalCombinations: 2,
          topSpeakersByEpisodes: []
        },
        speakers: [{
          id: 'speaker-1',
          name: 'Speaker',
          totalEpisodes: 10,
          clusters: [
            { clusterId: 'c1', clusterName: 'Cluster 1', count: 5, episodes: [1, 2, 3, 4, 5] },
            { clusterId: 'c2', clusterName: 'Cluster 2', count: 5, episodes: [6, 7, 8, 9, 10] }
          ]
        }],
        clusters: [
          { id: 'c1', name: 'Cluster 1', totalEpisodes: 5, topicCount: 10 },
          { id: 'c2', name: 'Cluster 2', totalEpisodes: 5, topicCount: 8 }
        ],
        matrix: [{
          speakerId: 'speaker-1',
          values: [
            { clusterId: 'c1', count: 5, episodes: [1, 2, 3, 4, 5] },
            { clusterId: 'c2', count: 5, episodes: [6, 7, 8, 9, 10] }
          ]
        }]
      };
      
      expect(data.speakers[0].clusters).toHaveLength(2);
      expect(data.matrix[0].values).toHaveLength(2);
      expect(data.clusters).toHaveLength(2);
    });

    it('should handle backward compatibility fields', () => {
      const data: HeatmapData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Legacy format',
        statistics: {
          totalSpeakers: 1,
          totalCombinations: 1,
          topSpeakersByEpisodes: []
        },
        speakers: [],
        matrix: [{
          speakerName: 'Legacy Speaker',  // Old format
          values: [{
            categoryName: 'Legacy Category',  // Old format
            count: 5,
            episodes: [1, 2, 3]
          }]
        }]
      };
      
      expect(data.matrix[0].speakerName).toBe('Legacy Speaker');
      expect(data.matrix[0].values[0].categoryName).toBe('Legacy Category');
    });
  });

  describe('Edge Cases and Boundaries', () => {
    it('should handle zero values', () => {
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Zero values',
        statistics: {
          totalTopics: 0,
          totalDurationHours: 0,
          yearRange: { start: 0, end: 0 },
          years: [],
          topicsByEpisodeCount: []
        },
        topics: {}
      };
      
      expect(data.statistics.totalTopics).toBe(0);
      expect(data.statistics.totalDurationHours).toBe(0);
    });

    it('should handle very large numbers', () => {
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Large numbers',
        statistics: {
          totalTopics: 1000000,
          totalDurationHours: 999999,
          yearRange: { start: 1900, end: 2100 },
          years: [],
          topicsByEpisodeCount: []
        },
        topics: {}
      };
      
      expect(data.statistics.totalTopics).toBeGreaterThan(999999);
      expect(data.statistics.totalDurationHours).toBe(999999);
    });

    it('should handle special characters in names', () => {
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Special chars: <>&"\'',
        statistics: {
          yearRange: { start: 2024, end: 2024 },
          years: [],
          topicsByEpisodeCount: []
        },
        topics: {
          'topic-1': {
            id: 'topic-1',
            name: 'Topic with "quotes" & <tags>',
            description: "Description with 'quotes'",
            totalEpisodes: 1,
            yearData: []
          }
        }
      };
      
      expect(data.topics['topic-1'].name).toContain('"quotes"');
      expect(data.topics['topic-1'].name).toContain('<tags>');
    });

    it('should handle unicode characters', () => {
      const data: SpeakerRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Unicode test',
        statistics: {
          totalSpeakers: 1,
          totalEpisodes: 1,
          totalAppearances: 1,
          totalDurationHours: 1,
          yearRange: { start: 2024, end: 2024 },
          years: [],
          topSpeakersByEpisodeCount: []
        },
        speakers: [{
          id: 'speaker-1',
          name: '日本語 中文 한국어 العربية',
          totalEpisodes: 1,
          totalDurationHours: 1,
          firstAppearance: 2024,
          lastAppearance: 2024,
          timeline: []
        }]
      };
      
      expect(data.speakers[0].name).toContain('日本語');
      expect(data.speakers[0].name).toContain('العربية');
    });
  });
});


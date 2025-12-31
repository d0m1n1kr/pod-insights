import { describe, it, expect } from 'vitest';
import type { TopicRiverData, SpeakerRiverData, HeatmapData } from '../types';

describe('Type Definitions', () => {
  describe('TopicRiverData', () => {
    it('should accept valid TopicRiverData', () => {
      const data: TopicRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test data',
        statistics: {
          totalTopics: 100,
          totalDurationHours: 500,
          yearRange: {
            start: 2010,
            end: 2024,
          },
          years: [2010, 2011, 2012],
          topicsByEpisodeCount: [
            {
              id: 'topic-1',
              name: 'Test Topic',
              count: 10,
            },
          ],
        },
        topics: {
          'topic-1': {
            id: 'topic-1',
            name: 'Test Topic',
            description: 'A test topic',
            totalEpisodes: 10,
            totalDurationMinutes: 120,
            yearData: [
              {
                year: 2024,
                count: 5,
                totalDurationMinutes: 60,
                episodes: [
                  {
                    number: 1,
                    date: '2024-01-01',
                    title: 'Test Episode',
                    durationMinutes: 60,
                  },
                ],
              },
            ],
          },
        },
      };

      expect(data.generatedAt).toBe('2024-01-01T00:00:00Z');
      expect(data.topics['topic-1'].name).toBe('Test Topic');
    });
  });

  describe('SpeakerRiverData', () => {
    it('should accept valid SpeakerRiverData', () => {
      const data: SpeakerRiverData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test speaker data',
        statistics: {
          totalSpeakers: 10,
          totalEpisodes: 100,
          totalAppearances: 150,
          totalDurationHours: 500,
          yearRange: {
            start: 2010,
            end: 2024,
          },
          years: [2010, 2011, 2012],
          topSpeakersByEpisodeCount: [
            {
              id: 'speaker-1',
              name: 'Test Speaker',
              count: 50,
            },
          ],
        },
        speakers: [
          {
            id: 'speaker-1',
            name: 'Test Speaker',
            totalEpisodes: 50,
            totalDurationHours: 100,
            firstAppearance: 2010,
            lastAppearance: 2024,
            timeline: [
              {
                year: 2024,
                episodeCount: 5,
                durationHours: 10,
                episodes: [1, 2, 3],
              },
            ],
          },
        ],
      };

      expect(data.speakers).toHaveLength(1);
      expect(data.speakers[0].name).toBe('Test Speaker');
    });
  });

  describe('HeatmapData', () => {
    it('should accept valid HeatmapData', () => {
      const data: HeatmapData = {
        generatedAt: '2024-01-01T00:00:00Z',
        description: 'Test heatmap',
        statistics: {
          totalSpeakers: 10,
          totalClusters: 20,
          totalCombinations: 200,
          topSpeakersByEpisodes: [
            {
              id: 'speaker-1',
              name: 'Test Speaker',
              count: 50,
            },
          ],
        },
        speakers: [
          {
            id: 'speaker-1',
            name: 'Test Speaker',
            totalEpisodes: 50,
            clusters: [
              {
                clusterId: 'cluster-1',
                clusterName: 'Test Cluster',
                count: 10,
                episodes: [1, 2, 3],
              },
            ],
          },
        ],
        clusters: [
          {
            id: 'cluster-1',
            name: 'Test Cluster',
            totalEpisodes: 20,
            topicCount: 5,
          },
        ],
        matrix: [
          {
            speakerId: 'speaker-1',
            speakerName: 'Test Speaker',
            values: [
              {
                clusterId: 'cluster-1',
                clusterName: 'Test Cluster',
                count: 10,
                episodes: [1, 2, 3],
              },
            ],
          },
        ],
      };

      expect(data.speakers).toHaveLength(1);
      expect(data.matrix).toHaveLength(1);
    });
  });
});


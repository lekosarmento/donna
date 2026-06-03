import { jest } from '@jest/globals';

// Configura o ambiente de teste
process.env.NODE_ENV = 'test';

// Mocks das conexões externas (Supabase)
jest.unstable_mockModule('../../src/config/supabase.js', () => {
  return {
    supabase: {
      from: jest.fn().mockReturnValue({
        upsert: jest.fn().mockResolvedValue({ error: null }),
        insert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null })
      })
    }
  };
});

// Importações dinâmicas após os mocks para ESM
const { getLocalDb, resetDbForTest } = await import('../../src/config/sqlite-db.js');
const { ScraperService } = await import('../../src/judges/scraper-service.js');
const { ProfileBuilder } = await import('../../src/judges/profile-builder.js');

describe('Pipeline de Profiling de Magistrados (Jurisprudência & IA)', () => {
  let db: any;
  const magistradoId = 'magistrado-test-123';
  const nomeMagistrado = 'Dra. Patricia de Albuquerque';

  beforeEach(() => {
    resetDbForTest();
    db = getLocalDb();

    // Insere o magistrado de teste no banco SQLite
    db.prepare(`
      INSERT INTO atores_judiciario (id, tipo, nome, tribunal, comarca, vara)
      VALUES (?, 'juiz', ?, 'TJPB', 'João Pessoa', '1ª Vara Cível')
    `).run(magistradoId, nomeMagistrado);
  });

  afterAll(() => {
    resetDbForTest();
  });

  describe('ScraperService (Jurisprudência TJPB / DJe)', () => {
    it('deve raspar e salvar decisões de forma idempotente (não duplica no banco)', async () => {
      // 1. Executa primeira raspagem (gera 15 decisões fictícias para o juiz)
      const novasDecisoes = await ScraperService.scrapeDecisoesMagistrado(nomeMagistrado, magistradoId, 15);
      expect(novasDecisoes).toBe(15);

      const totalSalvo = db.prepare('SELECT count(*) as count FROM raw_decisoes_magistrados WHERE magistrado_id = ?').get(magistradoId).count;
      expect(totalSalvo).toBe(15);

      // 2. Executa segunda raspagem de forma idêntica
      // As decisões devem ser ignoradas pois possuem chaves de processo idênticas
      const novasDecisoesDuplicadas = await ScraperService.scrapeDecisoesMagistrado(nomeMagistrado, magistradoId, 15);
      expect(novasDecisoesDuplicadas).toBe(0); // Nenhuma nova decisão inserida

      const totalSalvoAposDuplicacao = db.prepare('SELECT count(*) as count FROM raw_decisoes_magistrados WHERE magistrado_id = ?').get(magistradoId).count;
      expect(totalSalvoAposDuplicacao).toBe(15); // Mantém exatamente as 15 originais
    });
  });

  describe('Algoritmo de Cálculo do Grau de Confiança', () => {
    it('deve retornar confiança 1 se o volume de decisões for menor que 10', () => {
      const mockDecisoes = Array(5).fill({ data_decisao: '2026-06-01' });
      const trust = ProfileBuilder.calcularGrauConfianca(mockDecisoes);
      expect(trust).toBe(1);
    });

    it('deve retornar confiança 3 para ~60 decisões com variância de data estável', () => {
      const mockDecisoes = Array(60).fill(null).map((_, i) => ({
        data_decisao: new Date(2026, 0, 1 + (i * 2)).toISOString()
      }));
      const trust = ProfileBuilder.calcularGrauConfianca(mockDecisoes);
      expect(trust).toBe(3); // Base 3 (51-75 docs), sem bônus temporal significativo
    });

    it('deve conceder bônus de confiança se as decisões abrangerem mais de 2 anos (variância temporal)', () => {
      // 55 decisões cobrindo 3 anos (de 2023 a 2026)
      const mockDecisoes = Array(55).fill(null).map((_, i) => ({
        data_decisao: i % 2 === 0 ? '2023-01-01' : '2026-06-01'
      }));
      const trust = ProfileBuilder.calcularGrauConfianca(mockDecisoes);
      expect(trust).toBe(4); // Base 3 + 1 bônus temporal = 4 estrelas
    });

    it('deve penalizar se as decisões estiverem muito concentradas no tempo (< 90 dias)', () => {
      // 55 decisões em 10 dias
      const mockDecisoes = Array(55).fill(null).map((_, i) => ({
        data_decisao: `2026-06-0${i % 9 + 1}`
      }));
      const trust = ProfileBuilder.calcularGrauConfianca(mockDecisoes);
      expect(trust).toBe(2); // Base 3 - 1 penalidade por curto prazo = 2 estrelas
    });
  });

  describe('ProfileBuilder (Cognitive dossier & Claude AI)', () => {
    it('deve lançar erro se tentar criar perfil com menos de 10 decisões', async () => {
      // Salva apenas 5 decisões no banco local
      await ScraperService.scrapeDecisoesMagistrado(nomeMagistrado, magistradoId, 5);

      await expect(ProfileBuilder.gerarPerfilMagistrado(magistradoId)).rejects.toThrow(
        /Amostragem insuficiente para gerar perfil/
      );
    });

    it('deve gerar dossier cognitivo com sucesso se possuir amostragem superior a 10 decisões', async () => {
      // Insere 20 decisões
      await ScraperService.scrapeDecisoesMagistrado(nomeMagistrado, magistradoId, 20);

      const perfil = await ProfileBuilder.gerarPerfilMagistrado(magistradoId);
      
      expect(perfil).toBeDefined();
      expect(['legalista', 'garantista', 'pragmatico']).toContain(perfil.perfil_decisorio);
      expect(perfil.decisoes_analisadas).toBe(20);
      expect(perfil.grau_confianca).toBeGreaterThanOrEqual(1);

      // Confere se atualizou a tabela de atores_judiciario do SQLite
      const localAtor = db.prepare('SELECT * FROM atores_judiciario WHERE id = ?').get(magistradoId) as any;
      expect(localAtor.perfil_decisorio).toBe(perfil.perfil_decisorio);
      expect(localAtor.grau_confianca_perfil).toBe(perfil.grau_confianca);
      expect(localAtor.estilo_audiencia).toBe(perfil.estilo_audiencia);

      // Confere se registrou um snapshot na timeline do SQLite
      const snapshot = db.prepare('SELECT * FROM historico_perfis_magistrados WHERE magistrado_id = ?').get(magistradoId) as any;
      expect(snapshot).toBeDefined();
      expect(snapshot.perfil_decisorio).toBe(perfil.perfil_decisorio);
      expect(snapshot.decisoes_analisadas).toBe(20);
    });
  });
});
